import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

import * as eks from 'aws-cdk-lib/aws-eks';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';


export interface EksManagedNodeGroupProps {
    cluster: eks.Cluster;
}

export class EksManagedNodeGroup extends Construct {
    constructor(
        scope: Construct,
        id: string,
        props: EksManagedNodeGroupProps
    ) {
        super(scope, id);

        const nodeRole = new iam.Role(this, "EksNodeRole", {
            assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
          });
      
          nodeRole.addManagedPolicy(
            iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonEKSWorkerNodePolicy")
          );
          nodeRole.addManagedPolicy(
            iam.ManagedPolicy.fromAwsManagedPolicyName(
              "AmazonEC2ContainerRegistryReadOnly"
            )
          );
          nodeRole.addManagedPolicy(
            iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore")
          );

        
        props.cluster.addNodegroupCapacity('custom-node-group', {
            instanceTypes: [new ec2.InstanceType('m5.large'),
                            new ec2.InstanceType('c5.large'),
                            new ec2.InstanceType('t3.large'),],
            minSize: props.cluster.node.tryGetContext("node_group_min_size"),
            desiredSize: 2,
            maxSize: props.cluster.node.tryGetContext("node_group_max_size"),
            diskSize: 100,
            amiType: eks.NodegroupAmiType.AL2023_X86_64_STANDARD,
            capacityType: eks.CapacityType.SPOT, 
            nodeRole: nodeRole,
        });
    }
};