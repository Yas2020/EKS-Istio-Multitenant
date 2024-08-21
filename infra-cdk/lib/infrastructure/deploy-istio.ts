import { Construct } from "constructs";
import * as eks from 'aws-cdk-lib/aws-eks';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cdk from 'aws-cdk-lib';
import { readFileSync } from "fs";
import { CertManager } from "./cert-manager";

export interface IstioDeployProps {
  version: string;
  cluster: eks.Cluster;
  clusterName: string;
}

export class IstioDeploy extends Construct {
  constructor(scope: Construct, id: string, props: IstioDeployProps) {
    super(scope, id);

    const policyFile = readFileSync("./lib/policies/aws-load-balancer-controller.json", "utf-8");
    const albControllerPolicy = new iam.ManagedPolicy(this, "AWSLoadBalancerControllerIAMPolicy", {
      document: iam.PolicyDocument.fromJson(JSON.parse(policyFile))
    });
    const albControllerSA = props.cluster.addServiceAccount("aws-load-balancer-controller", {
      name: "aws-load-balancer-controller",
      namespace: "kube-system",
    });
    /* Grant permissions to AWS Load Balancer Controller to create and manage Load Balancers */
    albControllerSA.role.addManagedPolicy(albControllerPolicy);

    /* 
    Find matching version for K8s version:
    $ helm repo add eks https://aws.github.io/eks-charts
    $ helm search repo eks/aws-load-balancer-controller --versions chart version 1.8.1 
    is App version 2.8.1. From v2.6.0, the AWS LBC creates and attaches frontend and 
    backend security groups to NLB by default.
    https://kubernetes-sigs.github.io/aws-load-balancer-controller/v2.7/deploy/security_groups/
    */

    const albController = props.cluster.addHelmChart("ALBCtler", {
      chart: "aws-load-balancer-controller",
      release: "aws-load-balancer-controller",
      repository: "https://aws.github.io/eks-charts",
      version: "1.8.1",
      values: {
        clusterName: props.clusterName,
        serviceAccount: {
          create: false,
          name: "aws-load-balancer-controller",
        },
        vpcId: props.cluster.vpc.vpcId,
        region: cdk.Stack.of(this).region,
      },
      namespace: "kube-system",
      wait: true,
      timeout: cdk.Duration.minutes(5)
    });

    /* Install cert manager, cert signers, CAs, TLS cert */
    new CertManager(this, 'CertManager', { version: 'v1.15.1', cluster: props.cluster});

    /*
    Install the istio base chart which contains cluster-wide Custom Resource Definitions (CRDs) 
    which must be installed prior to the deployment of the istio control plane
    */

    const istioBase = props.cluster.addHelmChart('istioBase', {
      repository: "https://istio-release.storage.googleapis.com/charts",
      chart: "base",
      release: "istio-base",
      namespace: "istio-system",
      version: props.version,
      wait: true
    });
    istioBase.node.addDependency(albController);

    /* Deploy the istiod service */

    const istiod = props.cluster.addHelmChart("istiod", {
      repository: "https://istio-release.storage.googleapis.com/charts",
      chart: "istiod",
      release: "istio-istiod",
      namespace: "istio-system",
      version: props.version,
      wait: true,
      timeout: cdk.Duration.minutes(3)
    });
    istiod.node.addDependency(istioBase);

    /* 
    Add AWS specific annotations to the istio installation. This signals the AWS Load Balancer 
    Controller to automatically deploy a Network Load Balancer and associate it with our service,
    the Ingress Gateway service. After that, our mesh gets an external IP (hostname), 
    which is the entry point for incoming requests.
    The external value for aws-load-balancer-type is what causes the AWS Load Balancer Controller, 
    rather than the AWS cloud provider load balancer controller, to create the Network Load Balancer. Internet-facing 
    for schema causes nlb to be deployed in a public subnet. 
    When you specify the service.beta.kubernetes.io/aws-load-balancer-type annotation to be 
    external on a Kubernetes Service resource of type LoadBalancer, the in-tree controller 
    ignores the Service resource. In addition, if you specify the service.beta.kubernetes.io/aws-load-balancer-nlb-target-type 
    annotation on the Service resource, the LBC takes charge of reconciliation by provisioning an NLB.
    https://kubernetes-sigs.github.io/aws-load-balancer-controller/v2.7/guide/service/nlb/
    https://kubernetes-sigs.github.io/aws-load-balancer-controller/v2.7/guide/service/annotations/#healthcheck-port
    https://docs.aws.amazon.com/eks/latest/userguide/network-load-balancing.html
    For the application pods to see the client source IP address on your application pods, configure NLB proxy protocol v2 
    using an annotation ("aws-load-balancer-proxy-protocol": "*""). 
    */

    const ingressGateway = props.cluster.addHelmChart('istioGateway', {
      repository: "https://istio-release.storage.googleapis.com/charts",
      chart: "gateway",
      version: props.version,
      release: "istio-ingressgateway",
      namespace: "istio-ingress",
      values: {
        "service": {
          "annotations": {
            "service.beta.kubernetes.io/aws-load-balancer-type": "external",
            "service.beta.kubernetes.io/aws-load-balancer-scheme": "internet-facing",
            "service.beta.kubernetes.io/aws-load-balancer-name": props.clusterName.toLowerCase() + "-nlb",
            "service.beta.kubernetes.io/aws-load-balancer-nlb-target-type": "ip",
            "service.beta.kubernetes.io/aws-load-balancer-proxy-protocol": "*",
            "service.beta.kubernetes.io/aws-load-balancer-cross-zone-load-balancing-enabled": "true",
            // "service.beta.kubernetes.io/aws-load-balancer-backend-protocol": "tcp",
          }
        },    
      },
      wait: true,
      timeout: cdk.Duration.minutes(3) 
    });
    ingressGateway.node.addDependency(istiod);

    /* Create tls certificate for ingress gateway */
    const tls_issuer = props.cluster.addManifest('gateway-issuer', {
      apiVersion: "cert-manager.io/v1",
      kind: "Issuer",
      metadata: {
          name: "gateway-issuer",
          namespace: "istio-ingress"
      },
      spec: {
          selfSigned: {}
      }
    });
    tls_issuer.node.addDependency(ingressGateway);

    const tls_cert = props.cluster.addManifest('gateway-tls-cert', {
      apiVersion: "cert-manager.io/v1",
      kind: "Certificate",
      metadata: {
          name: "gateway-tls",
          namespace: "istio-ingress"
      },
      spec: {
          isCA: true,
          duration: "8760h", 
          commonName: "example.com",
          secretName: "gateway-ca-tls",
          privateKey: {
              algorithm: "ECDSA",
              size: 256
          },                 
          issuerRef: {
              name: "gateway-issuer",
              kind: "Issuer",
              group: "cert-manager.io"
          },
          dnsNames: [
              "example.com",
              "tenanta.example.com",
              "tenantb.example.com"
          ]
      }
    });
    tls_cert.node.addDependency(tls_issuer);

    /* 
    Since the external TCP load balancer is configured to forward TCP traffic and use the PROXY protocol, 
    the Istio Gateway TCP listener must also be configured to accept the PROXY protocol. In our case, we are 
    forwarding HTTP to the upstream not TCP. So we use XFF later to pass remote user ip in http header to the upstream
    Create Proxy Protocol Envoy Filter 
    https://www.envoyproxy.io/docs/envoy/latest/configuration/listeners/listener_filters/proxy_protocol
    https://istio.io/latest/docs/ops/configuration/traffic-management/network-topologies/
    If envoy is forwarding TCP with proxy protocol to upstream, it should be configured considering some performance hits. See
    https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/other_features/ip_transparency#proxy-protocol
    */

    const envoy_filter = props.cluster.addManifest('istio-ingress-proxy-protocol', {
      apiVersion: "networking.istio.io/v1alpha3",
      kind: "EnvoyFilter",
      metadata: {
        name: "proxy-protocol",
        namespace: "istio-ingress"
      },
      spec: {
        workloadSelector: {
          labels: {
            istio: "ingressgateway"
          }
        },
        configPatches: [
          {
            applyTo: "LISTENER",
            patch: {
              operation: "MERGE",
              value: {
              listener_filters: [
                {
                  name: "proxy_protocol",
                  typed_config: {
                    "@type": "type.googleapis.com/envoy.extensions.filters.listener.proxy_protocol.v3.ProxyProtocol",
                    // "allow_requests_without_proxy_protocol": "true"
                  }
                },
                {
                  name: "tls_inspector",
                  typed_config: {
                    "@type": "type.googleapis.com/envoy.extensions.filters.listener.tls_inspector.v3.TlsInspector",
                  }
                }
              ]}
            }
          }
        ]
      }
    });
    envoy_filter.node.addDependency(ingressGateway);

    /* 
    Enable X-Forwarded-For http header. 
    https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_conn_man/http_conn_man#config-http-conn-man
    This can be done by applying an envoy filter (or by annotating ingress pods (per ingress instance) or 
    configuring meshconfig for global effect if receiving http). 
    https://istio.io/latest/docs/ops/configuration/traffic-management/network-topologies/
    https://istio.io/latest/docs/ops/common-problems/upgrade-issues/ 
    */

    const X_Forwarded_For_header = props.cluster.addManifest('enable-XFF', {
      apiVersion: "networking.istio.io/v1alpha3",
      kind: "EnvoyFilter",
      metadata: {
        name: "ingressgateway-xff",
        namespace: "istio-ingress"
      },
      spec: {
        configPatches: [
          {
            applyTo: "NETWORK_FILTER",
            match: {
              listener: {
                filterChain: {
                  filter: {
                    name: "envoy.filters.network.http_connection_manager"
                  }
                }
              }
            },
            patch: {
              operation: "MERGE",
              value: {
                name: "envoy.filters.network.http_connection_manager",
                typed_config: {
                  "@type": "type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager",
                  "skip_xff_append": false,
                  "use_remote_address": true,
                  "xff_num_trusted_hops": 1
                }
              }
            }
          }
        ]
      }
    });
    X_Forwarded_For_header.node.addDependency(ingressGateway);
  
    const hostname = new eks.KubernetesObjectValue(this, 'LoadBalancerAttribute', {
      cluster: props.cluster,
      objectType: 'service',
      objectNamespace: 'istio-ingress',
      objectName: 'istio-ingressgateway',
      jsonPath: '.status.loadBalancer.ingress[0].hostname', 
    });
    hostname.node.addDependency(ingressGateway);

    /* https://kubernetes.io/docs/reference/kubectl/jsonpath/ */
    new cdk.CfnOutput(this, "LoadBalancerDomain", {
      value: hostname.value
    });
    
  };
};