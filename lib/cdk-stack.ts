import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

import * as eks from 'aws-cdk-lib/aws-eks';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
// import * as iam from 'aws-cdk-lib/aws-iam';

import { KubectlLayer } from 'aws-cdk-lib/lambda-layer-kubectl';
import { EksManagedNodeGroup } from "./infrastructure/eks-mng";



export class CdkStack extends cdk.Stack {
  constructor(scope: Construct, 
              id: string, 
              props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, 'Vpc', { ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'), 
                                            maxAzs: 2, 
                                            natGateways: 1 });

    const cluster = new eks.Cluster(this, 'Cluster', {
      vpc,
      version: eks.KubernetesVersion.V1_29,
      kubectlLayer: new KubectlLayer(this, 'kubectl')
    });

    const MngNodes = new EksManagedNodeGroup(this, "EksManagedNodeGroup", {
      cluster: cluster,
    });


  }
}
