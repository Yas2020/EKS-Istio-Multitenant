import { Construct } from 'constructs';
import * as eks from 'aws-cdk-lib/aws-eks';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';

export interface ManagedNodeGroupProps {
  cluster: eks.Cluster;
  sshKeyName: string
}

export class ManagedNodeGroup extends Construct {
  constructor(scope: Construct, id: string, props: ManagedNodeGroupProps) {
    super(scope, id);

    const nodeGroupRole = new iam.Role(this, 'nodeGroupRole', {
      roleName: 'nodeGroupRole',
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEKSWorkerNodePolicy'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEC2ContainerRegistryReadOnly'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEKS_CNI_Policy'),
      ],
    });
        
    props.cluster.addNodegroupCapacity('custom-node-group', {
      instanceTypes: [
        new ec2.InstanceType('t3.medium'),
        new ec2.InstanceType('t3a.medium'),
        // new ec2.InstanceType('t3.nano'),
      ],
      minSize: props.cluster.node.tryGetContext("node_group_min_size"),
      desiredSize: 2,
      maxSize: props.cluster.node.tryGetContext("node_group_max_size"),
      diskSize: 30,
      amiType: eks.NodegroupAmiType.AL2023_X86_64_STANDARD,
      capacityType: eks.CapacityType.SPOT, 
      nodeRole: nodeGroupRole,
      // remoteAccess: {'sshKeyName': props.sshKeyName}
    });
  };
};