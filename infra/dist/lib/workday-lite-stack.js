"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkdayLiteStack = void 0;
const path = __importStar(require("path"));
const cdk = __importStar(require("aws-cdk-lib"));
const aws_dynamodb_1 = require("aws-cdk-lib/aws-dynamodb");
const aws_s3_1 = require("aws-cdk-lib/aws-s3");
const aws_lambda_1 = require("aws-cdk-lib/aws-lambda");
const aws_lambda_nodejs_1 = require("aws-cdk-lib/aws-lambda-nodejs");
const aws_apigatewayv2_1 = require("aws-cdk-lib/aws-apigatewayv2");
const aws_apigatewayv2_integrations_1 = require("aws-cdk-lib/aws-apigatewayv2-integrations");
class WorkdayLiteStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        // Single-table DynamoDB for applications
        const table = new aws_dynamodb_1.Table(this, 'JobPortalTable', {
            partitionKey: { name: 'pk', type: aws_dynamodb_1.AttributeType.STRING },
            sortKey: { name: 'sk', type: aws_dynamodb_1.AttributeType.STRING },
            billingMode: aws_dynamodb_1.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY
        });
        // Private bucket for resumes
        const resumesBucket = new aws_s3_1.Bucket(this, 'JobPortalResumesBucket', {
            blockPublicAccess: aws_s3_1.BlockPublicAccess.BLOCK_ALL,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
            cors: [
                {
                    allowedOrigins: ['*'],
                    allowedMethods: [aws_s3_1.HttpMethods.PUT, aws_s3_1.HttpMethods.GET],
                    allowedHeaders: ['*'],
                    exposedHeaders: ['ETag']
                }
            ]
        });
        // Monolithic API Lambda
        const apiFn = new aws_lambda_nodejs_1.NodejsFunction(this, 'JobPortalApiFn', {
            entry: path.join(__dirname, '../lambda/job-portal-api.ts'),
            handler: 'handler',
            runtime: aws_lambda_1.Runtime.NODEJS_20_X,
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
        const httpApi = new aws_apigatewayv2_1.HttpApi(this, 'JobPortalHttpApi', {
            apiName: 'job-portal-api',
            corsPreflight: {
                allowOrigins: ['*'],
                allowMethods: [aws_apigatewayv2_1.CorsHttpMethod.ANY],
                allowHeaders: ['*']
            }
        });
        const integration = new aws_apigatewayv2_integrations_1.HttpLambdaIntegration('JobPortalLambdaIntegration', apiFn);
        httpApi.addRoutes({
            path: '/applications',
            methods: [aws_apigatewayv2_1.HttpMethod.POST],
            integration
        });
        httpApi.addRoutes({
            path: '/applications/{id}',
            methods: [aws_apigatewayv2_1.HttpMethod.GET, aws_apigatewayv2_1.HttpMethod.PUT],
            integration
        });
        httpApi.addRoutes({
            path: '/upload-url',
            methods: [aws_apigatewayv2_1.HttpMethod.POST],
            integration
        });
        httpApi.addRoutes({
            path: '/magic-link',
            methods: [aws_apigatewayv2_1.HttpMethod.POST],
            integration
        });
        httpApi.addRoutes({
            path: '/magic-link/validate',
            methods: [aws_apigatewayv2_1.HttpMethod.POST],
            integration
        });
        // Public static site bucket for SPA frontend
        const staticSiteBucket = new aws_s3_1.Bucket(this, 'JobPortalStaticSiteBucket', {
            websiteIndexDocument: 'index.html',
            publicReadAccess: true,
            blockPublicAccess: aws_s3_1.BlockPublicAccess.BLOCK_ACLS,
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
exports.WorkdayLiteStack = WorkdayLiteStack;
