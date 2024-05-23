import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

import * as eks from 'aws-cdk-lib/aws-eks';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';

import { KubectlLayer } from 'aws-cdk-lib/lambda-layer-kubectl';
import { ManagedNodeGroup } from "./infrastructure/node-groups";



export class CdkStack extends cdk.Stack {
  constructor(scope: Construct, 
              id: string, 
              props?: cdk.StackProps) {
    super(scope, id, props);

    const mastersRole = new iam.Role(this, 'MastersRole', {
      assumedBy: new cdk.aws_iam.ArnPrincipal("arn:aws:iam::253226449123:user/YasCode"), // change me!
    });

    const vpc = new ec2.Vpc(this, 'Vpc', { maxAzs: 2 })
    // , { ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'), 
    //                                         maxAzs: 2, 
    //                                         natGateways: 2 });

    const cluster = new eks.Cluster(this, 'Cluster', {
      vpc,
      defaultCapacity: 0,
      version: eks.KubernetesVersion.V1_29,
      kubectlLayer: new KubectlLayer(this, 'kubectl')
    });

    const MngNodes = new ManagedNodeGroup(this, "EksManagedNodeGroup", {
      cluster: cluster,
    });


  }
}
