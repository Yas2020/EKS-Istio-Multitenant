import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { DockerImageAsset } from 'aws-cdk-lib/aws-ecr-assets';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from "constructs";
import { SystemConfig } from "./types";
import * as path from 'path';

export interface SharedProps {
    readonly config: SystemConfig;
}

export class Shared extends Construct {
    readonly vpc: ec2.Vpc;
    readonly app_asset: DockerImageAsset;
    readonly api_asset: DockerImageAsset;

    constructor(scope: Construct, id: string, props: SharedProps) {
        super(scope, id);

        /* Build images and store them in repositories */
        this.app_asset = new DockerImageAsset(scope, 'AppBuildImage', {
            directory: path.join('image-build/app-build'),
            buildArgs: {
                tag: "latest"
            }
        });

        this.api_asset = new DockerImageAsset(scope, 'ApiBuildImage', {
            directory: path.join('image-build/rag-api-build'),
            buildArgs: {
                tag: "latest"
            }
        });

        let vpc: ec2.Vpc;
        if (!props.config.vpc?.vpcId) {
            vpc = new ec2.Vpc(this, "VPC", {
                vpcName: "MyEksCluster", 
                maxAzs: 2,
                natGateways: 1,
                restrictDefaultSecurityGroup: false,
                subnetConfiguration: [
                    {
                        name: "public",
                        subnetType: ec2.SubnetType.PUBLIC,
                    },
                    {
                        name: "private",
                        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
                    },
                    // {
                    //     name: "isolated",
                    //     subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
                    // },
                ],

            })
        } else {
            vpc = ec2.Vpc.fromLookup(this, "VPC", {
                vpcId: props.config.vpc.vpcId,
            }) as ec2.Vpc;
        }

        this.vpc = vpc;

        /* Creating S3 Bucket Policy for Envoy Dynamic Configuration Files */
        let bucket = new s3.Bucket(this, 'Bucket', {
            bucketName: `envoy-config-${cdk.Stack.of(this).node.addr.slice(0,5)}`,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            autoDeleteObjects: true,
            encryption: s3.BucketEncryption.S3_MANAGED,
            enforceSSL: true,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });

        new s3deploy.BucketDeployment(this, `EnvoyConfigAsset`, {
            prune: false,
            sources: [s3deploy.Source.asset('/home/project/envoy-config')],
            destinationBucket: bucket,
        });
        
        for (const tenant of props.config.tenants) {
            let bucket = new s3.Bucket(scope, `Bucket-${tenant}`, {
                bucketName: `contextual-data-${tenant}-${cdk.Stack.of(this).node.addr.slice(0,5)}`,
                autoDeleteObjects: true,
                blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
                encryption: s3.BucketEncryption.S3_MANAGED,
                enforceSSL: true,
                removalPolicy: cdk.RemovalPolicy.DESTROY,
            });

            if (tenant === "tenanta") {
                new s3deploy.BucketDeployment(this, "ContextualDataDeployment-tenanta", {
                    prune: false,
                    sources: [
                        s3deploy.Source.asset('/home/project/data/Amazon_SageMaker_FAQs.zip'),
                    ],
                    destinationBucket: bucket,
                });
                new s3deploy.BucketDeployment(this, "ContextualEmbeddingDeployment-tenanta", {
                    prune: false,
                    sources: [
                        s3deploy.Source.asset('/home/project/faiss_index/faiss_index-tenanta/')
                    ],
                    destinationKeyPrefix: "faiss_index",
                    destinationBucket: bucket,
                });
            } else {
                new s3deploy.BucketDeployment(this, "ContextualDataDeployment-tenantb", {
                    prune: false,
                    sources: [
                        s3deploy.Source.asset('/home/project/data/Amazon_EMR_FAQs.zip'),
                    ],
                    destinationBucket: bucket,
                });
                new s3deploy.BucketDeployment(this, `ContextualEmbeddingDeployment-tenantb`, {
                    prune: false,
                    sources: [
                        s3deploy.Source.asset('/home/project/faiss_index/faiss_index-tenantb/')
                    ],
                    destinationKeyPrefix: "faiss_index",
                    destinationBucket: bucket,
                });
            };

            new dynamodb.Table(this, `Session-${tenant}`, {
                tableName: `Sessions_${tenant}_${cdk.Stack.of(this).node.addr.slice(0,5)}`,
                partitionKey: {
                  name: "TenantId",
                  type: dynamodb.AttributeType.STRING,
                },
                billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
                encryption: dynamodb.TableEncryption.AWS_MANAGED,
                pointInTimeRecovery: true,
                removalPolicy: cdk.RemovalPolicy.DESTROY,
            });

            new dynamodb.Table(this, `ChatHistory_-${tenant}`, {
                tableName: `ChatHistory__${tenant}_${cdk.Stack.of(this).node.addr.slice(0,5)}`,
                partitionKey: {
                  name: "SessionId",
                  type: dynamodb.AttributeType.STRING,
                },
                billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
                encryption: dynamodb.TableEncryption.AWS_MANAGED,
                pointInTimeRecovery: true,
                removalPolicy: cdk.RemovalPolicy.DESTROY,
            });
        };
        
    };
}