import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda-nodejs';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';

interface TickerValuesStackProps extends cdk.StackProps {
  spreadSheetId: string;
  alertEmail: string;
}

export class TickerValuesStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: TickerValuesStackProps) {
    super(scope, id, props);

    // CloudWatch Log Group for the Lambda function
    const logGroup = new logs.LogGroup(this, 'TickerFunctionLogGroup', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    // Lambda function for ticker values processing
    const tickerFunction = new lambda.NodejsFunction(this, 'TickerFunction', {
      entry: 'lambda/ticker-handler.ts',
      handler: 'handler',
      timeout: cdk.Duration.minutes(15),
      memorySize: 512,
      environment: {
        SPREADSHEET_ID: props.spreadSheetId,
        GOOGLE_CREDENTIALS_PARAMETER: '/iuk/ticker-values/google-credentials',
        POWERTOOLS_LOG_LEVEL: 'DEBUG',
      },
      logGroup: logGroup,
      bundling: {
        sourceMap: true,
        minify: false, // Keep readable for debugging
        externalModules: ['canvas'],
        nodeModules: ['jsdom']

      }
    });

    // Grant permission to read from Parameter Store
    tickerFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ssm:GetParameter'],
      resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/iuk/ticker-values/google-credentials`]
    }));

    // IAM role for EventBridge Scheduler
    const schedulerRole = new iam.Role(this, 'SchedulerRole', {
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
      inlinePolicies: {
        LambdaInvokePolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['lambda:InvokeFunction'],
              resources: [tickerFunction.functionArn]
            })
          ]
        })
      }
    });

    // EventBridge Scheduler with timezone support
    new scheduler.CfnSchedule(this, 'DailyTickerSchedule', {
      flexibleTimeWindow: {
        mode: 'OFF'
      },
      scheduleExpression: 'cron(* */2 * * ? *)', // Every two hours
      scheduleExpressionTimezone: 'Europe/Berlin', // CET/CEST timezone
      target: {
        arn: tickerFunction.functionArn,
        roleArn: schedulerRole.roleArn
      },
      description: 'Trigger ticker function daily at 06:30 CET (handles DST automatically)'
    });



    // CloudWatch Metric Filter to count ERROR level logs
    const errorMetricFilter = new logs.MetricFilter(this, 'ErrorMetricFilter', {
      logGroup: logGroup,
      metricNamespace: 'TickerValues',
      metricName: 'ErrorCount',
      filterPattern: logs.FilterPattern.stringValue('$.level', '=', 'ERROR'),
      metricValue: '1',
      defaultValue: 0
    });

    // SNS Topic for error notifications
    const errorTopic = new sns.Topic(this, 'TickerErrorTopic', {
      topicName: 'ticker-values-errors',
      displayName: 'Ticker Values Error Notifications'
    });

    // Email subscription for error notifications
    errorTopic.addSubscription(new subscriptions.EmailSubscription(props.alertEmail));

    // CloudWatch Alarm for error count
    const errorAlarm = new cloudwatch.Alarm(this, 'TickerErrorAlarm', {
      metric: errorMetricFilter.metric({
        statistic: 'Sum',
        period: cdk.Duration.minutes(5)
      }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'Alarm when ticker function encounters errors',
      alarmName: 'TickerValues-ErrorCount'
    });

    // Add SNS action to the alarm
    errorAlarm.addAlarmAction(new cloudwatchActions.SnsAction(errorTopic));
  }
}
