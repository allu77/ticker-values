import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'; 
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';

interface TickerValuesStackProps extends cdk.StackProps {
  spreadSheetId: string;
  alertEmail: string;
  failureThreshold: number;
  pollIntervalHours: number;
}

export class TickerValuesStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: TickerValuesStackProps) {
    super(scope, id, props);

    // CloudWatch Log Group for the Lambda function
    const tickerFunctionLogGroup = new logs.LogGroup(this, 'TickerFunctionLogGroup', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    const alertingFunctionLogGroup = new logs.LogGroup(this, 'AlertingFunctionLogGroup', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    // Lambda function for ticker values processing
    const tickerFunction = new NodejsFunction(this, 'TickerFunction', {
      entry: 'lambda/ticker-handler.ts',
      description: 'Fetches ticker list from Google Sheets, retrieves latest values and updates the sheet back',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: cdk.Duration.minutes(15),
      memorySize: 512,
      environment: {
        SPREADSHEET_ID: props.spreadSheetId,
        GOOGLE_CREDENTIALS_PARAMETER: '/iuk/ticker-values/google-credentials',
        POWERTOOLS_LOG_LEVEL: 'DEBUG',
      },
      logGroup: tickerFunctionLogGroup,
      bundling: {
        sourceMap: true,
        minify: false,
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

    // EventBridge Scheduler — interval driven by pollIntervalHours
    new scheduler.CfnSchedule(this, 'DailyTickerSchedule', {
      flexibleTimeWindow: {
        mode: 'OFF'
      },
      scheduleExpression: `cron(0 */${props.pollIntervalHours} * * ? *)`,
      scheduleExpressionTimezone: 'Europe/Berlin',
      target: {
        arn: tickerFunction.functionArn,
        roleArn: schedulerRole.roleArn
      },
      description: `Trigger ticker function every ${props.pollIntervalHours} hour(s) (Europe/Berlin timezone)`
    });

    // CloudWatch Metric Filter to count ERROR level logs
    const errorMetricFilter = new logs.MetricFilter(this, 'ErrorMetricFilter', {
      logGroup: tickerFunctionLogGroup,
      metricNamespace: 'TickerValues',
      metricName: 'ErrorCount',
      filterPattern: logs.FilterPattern.stringValue('$.level', '=', 'ERROR'),
      metricValue: '1',
      defaultValue: 0
    });

    // SNS Topic for notifications (alert emails published here by the Alerting Lambda)
    const errorTopic = new sns.Topic(this, 'TickerErrorTopic', {
      topicName: 'ticker-values-errors',
      displayName: 'Ticker Values Error Notifications'
    });

    errorTopic.addSubscription(new subscriptions.EmailSubscription(props.alertEmail));

    // CloudWatch Alarm: fires within ~5 minutes of any ticker Lambda run that produces errors.
    // Short period ensures the alarm resets well before the next scheduled run (every pollIntervalHours).
    // Consecutive failure detection is handled entirely by the Logs Insights query in the Alerting Lambda.
    const errorAlarm = new cloudwatch.Alarm(this, 'TickerErrorAlarm', {
      metric: errorMetricFilter.metric({
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      datapointsToAlarm: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmName: 'TickerValues-Errors',
      alarmDescription: 'Fires when any ticker Lambda run produces errors',
    });

    // Alerting Lambda: triggered by EventBridge on alarm state change; queries Logs Insights
    // to identify consistently-failing tickers and sends a rich notification email.
    const alertingFunction = new NodejsFunction(this, 'AlertingFunction', {
      entry: 'lambda/alerting-handler.ts',
      description: 'Triggered by CloudWatch Alarm; queries Logs Insights to identify consistently-failing tickers and sends alert email',
      logGroup: alertingFunctionLogGroup,
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: cdk.Duration.minutes(2),
      environment: {
        LOG_GROUP_NAME: tickerFunctionLogGroup.logGroupName,
        FAILURE_THRESHOLD: props.failureThreshold.toString(),
        POLL_INTERVAL_HOURS: props.pollIntervalHours.toString(),
        SNS_TOPIC_ARN: errorTopic.topicArn,
      },
      bundling: {
        sourceMap: true,
        minify: false,
      },
      
    });

    alertingFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['logs:StartQuery', 'logs:GetQueryResults', 'logs:StopQuery'],
      resources: [tickerFunctionLogGroup.logGroupArn],
    }));
    errorTopic.grantPublish(alertingFunction);

    // EventBridge rule: triggers the Alerting Lambda on every ALARM state change.
    // Because the alarm period is short (5 min), it resets between ticker runs and fires fresh each time.
    const alarmRule = new events.Rule(this, 'AlarmStateChangeRule', {
      eventPattern: {
        source: ['aws.cloudwatch'],
        detailType: ['CloudWatch Alarm State Change'],
        detail: {
          alarmName: [errorAlarm.alarmName],
          state: { value: ['ALARM'] },
        },
      },
    });
    alarmRule.addTarget(new targets.LambdaFunction(alertingFunction));

  }
}
