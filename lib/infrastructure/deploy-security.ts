import * as cdk from "aws-cdk-lib";
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as iam from 'aws-cdk-lib/aws-iam';
import * as eks from 'aws-cdk-lib/aws-eks';
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";

import { Construct } from "constructs";
import { SystemConfig } from "../shared/types";

export interface ConfigAuthProps {
  config: SystemConfig;
  cluster: eks.Cluster
  envoySvcAccountRole: iam.Role;
  appImageURL: string,
  ragRagImageURL: string
};

export class ConfigAuth extends Construct {
  constructor(scope: Construct, id: string, props: ConfigAuthProps) {
    super(scope, id);
    const {
      config,
      cluster,
      envoySvcAccountRole,
      appImageURL,
      ragRagImageURL
    } = props;

    const buildBucket = new s3.Bucket(this, "buildBucket", {
      bucketName: `build-bucket-${cdk.Stack.of(this).node.addr.slice(0,5)}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      autoDeleteObjects: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Upload build code to S3
    new s3deploy.BucketDeployment(this, "Script", {
      sources: [s3deploy.Source.asset("./codeBuild")],
      retainOnDelete: false,
      destinationBucket: buildBucket,
      destinationKeyPrefix: "scripts",
    });

    const buildSpec1 = codebuild.BuildSpec.fromObject({
      version: "0.2",
      phases: {
        install: {
          commands: [
            'echo "Updating system packages..."',
            "sudo apt-get update",
            'echo "Installing curl, wget, jq, tar, awscli"',
            "apt-get install -y curl wget jq tar awscli",
            'echo "Installing kubectl..."',
            'curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"',
            'chmod +x ./kubectl',
            'echo "kubectl Version:"',
            'kubectl version --client=true',
            'echo "Installing helm"',
            'curl --no-progress-meter \
              -sSL https://raw.githubusercontent.com/helm/helm/master/scripts/get-helm-3 | bash',
            'echo "helm Version:"',
            'helm version',
          ],
        },
        pre_build: {
          commands: [
            'echo "Downloading build code from S3..."',
            "aws s3 cp s3://$BUILD_BUCKET/scripts/ ./build --recursive",
            "ls -al",
            "ls -al ./build",
          ],
        },
        build: {
          commands: [
            'echo "Configuring istio proxies..."',
            "bash build/configure-proxies.sh",
            'echo "istio proxies configured!"',
          ],
        },
      },
    });
    
    // CodeBuild project
    const project1 = new codebuild.Project(this, "CodeBuildProject", {
      buildSpec: buildSpec1,
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        computeType: codebuild.ComputeType.SMALL,
      },
      environmentVariables: {
        AWS_REGION: {
          value: cdk.Stack.of(this).region
        },
        ISTIO_VERSION: {
          value: config.ISTIO_VERSION
        },
        BUILD_BUCKET: {
          value: buildBucket.bucketName,
        },
        ENVOY_CONFIG_BUCKET: {
          value: `envoy-config-${cdk.Stack.of(this).node.addr.slice(0,5)}`
        },
        ENVOY_S3_ACCESS_ROLE: {
          value: envoySvcAccountRole.roleArn
        },
        EKS_CLUSTER_NAME: {
          value: cluster.clusterName
        },
      },
    });

    const buildSpec2 = codebuild.BuildSpec.fromObject({
      version: "0.2",
      phases: {
        install: {
          commands: [
            'echo "Updating system packages..."',
            "sudo apt-get update",
            'echo "Installing curl, wget, jq, tar, awscli"',
            "apt-get install -y curl wget jq tar awscli",
            'echo "Installing kubectl..."',
            'curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"',
            'chmod +x ./kubectl',
            'echo "kubectl Version:"',
            'kubectl version --client=true',
          ],
        },
        pre_build: {
          commands: [
            'echo "Downloading build code from S3..."',
            "aws s3 cp s3://$BUILD_BUCKET/scripts/ ./build --recursive",
            "ls -al",
            "ls -al ./build",
          ],
        },
        build: {
          commands: [
            'echo "Configuring istio..."',
            "bash build/deploy-tenant-services.sh",
            'echo "istio configured!"',
          ],
        },
      },
    });
  
    const project2 = new codebuild.Project(this, "CodeBuildProject2", {
      buildSpec: buildSpec2,
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        computeType: codebuild.ComputeType.SMALL,
      },
      environmentVariables: {
        ACCOUNT_ID: {
          value: cdk.Stack.of(this).account
        },
        AWS_REGION: {
          value: cdk.Stack.of(this).region
        },
        RANDOM_STRING: {
          value: cdk.Stack.of(this).node.addr.slice(0,5)
        },
        BUILD_BUCKET: {
          value: buildBucket.bucketName,
        },
        ENVOY_CONFIG_BUCKET: {
          value: `envoy-config-${cdk.Stack.of(this).node.addr.slice(0,5)}`
        },
        EKS_CLUSTER_NAME: {
          value: cluster.clusterName
        },
        CHATBOT_IMAGE_URI: {
          value: appImageURL               
        },
        RAGAPI_IMAGE_URI: {
          value: ragRagImageURL
        },
        TEXT2TEXT_MODEL_ID: {
          value: config.TEXT2TEXT_MODEL_ID
        },
        EMBEDDING_MODEL_ID: {
          value: config.EMBEDDING_MODEL_ID
        },
        BEDROCK_SERVICE: {
          value: config.BEDROCK_SERVICE
        }
      },
    });
      
    buildBucket.grantReadWrite(project1.role!);
    cluster.awsAuth.addMastersRole(project1.role!);

    project1.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        "eks:DescribeNodegroup",
        "eks:DescribeUpdate",
        "eks:DescribeCluster"
      ],
      resources: [cluster.clusterArn],
    }));

    project1.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        "cognito-idp:DescribeUserPoolDomain",
        "cognito-idp:ListUserPoolClients",
        "cognito-idp:DescribeUserPoolClient"
      ],
      resources: ['*'],
    }));

    buildBucket.grantReadWrite(project2.role!);
    cluster.awsAuth.addMastersRole(project2.role!);

    project2.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        "eks:DescribeNodegroup",
        "eks:DescribeUpdate",
        "eks:DescribeCluster"
      ],
      resources: [cluster.clusterArn],
    }));

    project2.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        "cognito-idp:DescribeUserPoolDomain",
        "cognito-idp:ListUserPoolClients",
        "cognito-idp:DescribeUserPoolClient"
      ],
      resources: ['*'],
    }));

    project2.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        "cognito-idp:DescribeUserPoolDomain",
        "cognito-idp:ListUserPoolClients",
        "cognito-idp:DescribeUserPoolClient"
      ],
      resources: ['*'],
    }));
  }
}