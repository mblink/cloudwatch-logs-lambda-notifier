# CloudWatch Logs lambda notifier

[![Build Status](https://travis-ci.org/mrdziuban/cloudwatch-logs-lambda-notifier.svg?branch=master)](https://travis-ci.org/mrdziuban/cloudwatch-logs-lambda-notifier)

This is a [lambda](https://aws.amazon.com/lambda/) that will notify via email about alarms triggered by Cloudwatch
Logs events using the SendGrid API.

## Setup

Clone the repository, then run the following:

```bash
$ npm install
$ cp .env.sample .env
$ cp deploy.env.sample deploy.env
$ cp event.json.sample event.json
```

In `.env`, replace the value of `AWS_ROLE_ARN` with the value you create below in ["Create a role"](#create-a-role).
Replace other config values as necessary,

In `deploy.env`, add your own secret values to use when sending the email notification with SendGrid. The values are:

- `FROM_EMAIL`: The email address you'd like the notification to appear to be sent from
- `TO_EMAIL`: The email address you'd like the notification to be sent to
- `SENDGRID_API_KEY`: Your SendGrid API key. If necessary, you can [create a new one here](https://app.sendgrid.com/settings/api_keys)

### Create a role

In the [IAM roles console](https://console.aws.amazon.com/iam/home#/roles), create a new role. When you're prompted
to choose a role type, select "AWS Lambda." When you're prompted to attach policies, attach the one named
"CloudWatchLogsReadOnlyAccess."

Once you've finished creating the role, copy the ARN and put it in `.env` as mentioned above.

## Run locally

To run the lambda function locally using the contents of `event.json` as the payload, run:

```bash
$ npm run local
```

## Deploy

To deploy the lambda to AWS, run:

```bash
$ npm run deploy
```

## Package

If you want to package the lambda as a zip file for manual upload to AWS, run:

```bash
$ npm run package
```

### Subscribe to a CloudWatch alarm

In the [CloudWatch alarms console](https://console.aws.amazon.com/cloudwatch/home#alarm:alarmFilter=ANY), create a
new alarm for your log stream and specify the SNS topic that it should send notifications to (you'll have the option
to create a new one).

Once that's done, find your SNS topic's ARN in the
[SNS topics console](https://console.aws.amazon.com/sns/v2/home#/topics) and create a new subscription in the
[SNS subscriptions console](https://console.aws.amazon.com/sns/v2/home#/subscriptions). Your subscription should look
like this:

![subscription](https://cloud.githubusercontent.com/assets/4718399/24247231/3bd1c458-0fa1-11e7-8762-23eb03735462.png)
