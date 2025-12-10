import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

import {
  Table,
  AttributeType,
  BillingMode
} from 'aws-cdk-lib/aws-dynamodb';
import {
  Bucket,
  BlockPublicAccess,
  HttpMethods
} from 'aws-cdk-lib/aws-s3';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import {
  HttpApi,
  CorsHttpMethod,
  HttpMethod
} from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';

export class WorkdayLiteStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Single-table DynamoDB for applications
    const table = new Table(this, 'JobPortalTable', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      sortKey: { name: 'sk', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    // Private bucket for resumes
    const resumesBucket = new Bucket(this, 'JobPortalResumesBucket', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      cors: [
        {
          allowedOrigins: ['*'],
          allowedMethods: [HttpMethods.PUT, HttpMethods.GET],
          allowedHeaders: ['*'],
          exposedHeaders: ['ETag']
        }
      ]
    });

    // Monolithic API Lambda
    const apiFn = new NodejsFunction(this, 'JobPortalApiFn', {
      entry: path.join(__dirname, '../lambda/job-portal-api.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      bundling: {
        minify: true,
        sourceMap: true
      },
      environment: {
        TABLE_NAME: table.tableName,
        BUCKET_NAME: resumesBucket.bucketName
      }
    });

    table.grantReadWriteData(apiFn);
    resumesBucket.grantReadWrite(apiFn);

    // HTTP API Gateway
    const httpApi = new HttpApi(this, 'JobPortalHttpApi', {
      apiName: 'job-portal-api',
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [CorsHttpMethod.ANY],
        allowHeaders: ['*']
      }
    });

    const integration = new HttpLambdaIntegration(
      'JobPortalLambdaIntegration',
      apiFn
    );

    httpApi.addRoutes({
      path: '/applications',
      methods: [HttpMethod.POST],
      integration
    });

    httpApi.addRoutes({
      path: '/applications/{id}',
      methods: [HttpMethod.GET, HttpMethod.PUT],
      integration
    });

    httpApi.addRoutes({
      path: '/upload-url',
      methods: [HttpMethod.POST],
      integration
    });

    // Public static site bucket for SPA frontend
    const staticSiteBucket = new Bucket(this, 'JobPortalStaticSiteBucket', {
      websiteIndexDocument: 'index.html',
      publicReadAccess: true,
      blockPublicAccess: BlockPublicAccess.BLOCK_ACLS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true
    });

    new cdk.CfnOutput(this, 'HttpApiUrl', {
      value: httpApi.apiEndpoint
    });

    new cdk.CfnOutput(this, 'StaticSiteUrl', {
      value: staticSiteBucket.bucketWebsiteUrl
    });

    new cdk.CfnOutput(this, 'StaticSiteBucketName', {
      value: staticSiteBucket.bucketName
    });
  }
}
