import { Construct } from "constructs";
import * as eks from 'aws-cdk-lib/aws-eks';
import * as cdk from 'aws-cdk-lib';

export interface CertManagerProps {
    version: string;
    cluster: eks.Cluster;
}

export class CertManager extends Construct {
  constructor(scope: Construct, id: string, props: CertManagerProps) {
    super(scope, id);

    /* 
    Install cert-manager. Install CustomResourceDefinitions as well using crds.enabled=true values
    Deploy custom CA controller in the Kubernetes cluster
    */
    const certManager = props.cluster.addHelmChart('certManager', {
      repository: "https://charts.jetstack.io",
      chart: "cert-manager",
      release: "cert-manager",
      namespace: "cert-manager",
      version: props.version,
      values: {
        "crds": {"enabled": "true"},
        "featureGates": "ExperimentalCertificateSigningRequestControllers=true"
      },
      wait: true,
    });

    const selfSingedIssuersNames = ["selfsigned-istio-issuer", "selfsigned-tenanta-issuer", "selfsigned-tenantb-issuer"];
    const certificateNames = ["istio-ca", "tenanta-ca", "tenantb-ca"];
    const signerNames = ["istio-system", "tenanta", "tenantb"];
    const secretNames = ["istio-ca-selfsigned", "tenanta-ca-selfsigned", "tenantb-ca-selfsigned"]

    for (let i=0; i<3; i++) {
        const self_issuer = props.cluster.addManifest('selfsigned-issuer' + i, {
            apiVersion: "cert-manager.io/v1",
            kind: "ClusterIssuer",
            metadata: {
                name: selfSingedIssuersNames[i]
            },
            spec: {
                selfSigned: {}
            }
        });
        self_issuer.node.addDependency(certManager);

        const cert = props.cluster.addManifest('cert-' + i, {
            apiVersion: "cert-manager.io/v1",
            kind: "Certificate",
            metadata: {
                name: certificateNames[i],
                namespace: "cert-manager"
            },
            spec: {
                isCA: true,
                duration: "8760h", // 1 year
                commonName: signerNames[i],
                secretName: secretNames[i],
                privateKey: {
                    algorithm: "ECDSA",
                    size: 256
                },                 
                issuerRef: {
                    name: selfSingedIssuersNames[i],
                    kind: "ClusterIssuer",
                    group: "cert-manager.io"
                }
            }
        });
        cert.node.addDependency(self_issuer);

        const cert_signer = props.cluster.addManifest('cert-signer' + i, {
            apiVersion: "cert-manager.io/v1",
            kind: "ClusterIssuer",
            metadata: {
                name: signerNames[i]
            },
            spec: {
                ca: {
                    secretName: secretNames[i]
                }
            }
        });
        cert_signer.node.addDependency(cert);
    };
}};
