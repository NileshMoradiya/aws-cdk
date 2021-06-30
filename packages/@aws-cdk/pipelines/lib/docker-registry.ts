import * as ec2 from '@aws-cdk/aws-ec2';
import * as ecr from '@aws-cdk/aws-ecr';
import * as iam from '@aws-cdk/aws-iam';
import * as secretsmanager from '@aws-cdk/aws-secretsmanager';
import { Fn } from '@aws-cdk/core';

/** Docstrings */
export abstract class DockerRegistry {
  /** Docstrings */
  public static fromDockerHub(opts: ExternalDockerRegistryOptions): DockerRegistry {
    return new ExternalDockerRegistry('index.docker.io', opts);
  }

  /** Docstrings */
  public static fromCustomRegistry(registryDomain: string, opts: ExternalDockerRegistryOptions): DockerRegistry {
    return new ExternalDockerRegistry(registryDomain, opts);
  }

  /** Docstrings */
  public static fromEcr(repositories: ecr.IRepository[], opts?: EcrDockerRegistryOptions): DockerRegistry {
    return new EcrDockerRegistry(repositories, opts ?? {});
  }

  /** Docstrings */
  public abstract registryDomain: string;
  /** Docstrings */
  public abstract grantRead(grantee: iam.IGrantable): void;
  /**
   * Docstrings
   * @internal
   */
  public abstract _renderCdkAssetsConfig(): DockerRegistryCredentialSource
}

/** Docstrings */
export interface ExternalDockerRegistryOptions {
  /** Docstrings */
  readonly secret: secretsmanager.ISecret;
  /** Docstrings */
  readonly secretUsernameField?: string;
  /** Docstrings */
  readonly secretPasswordField?: string;
  /** Docstrings */
  readonly assumeRole?: iam.IRole
  /** Docstrings */
  readonly usages?: DockerRegistryUsage[];
}

/** Docstrings */
export interface EcrDockerRegistryOptions {
  /** Docstrings */
  readonly assumeRole?: iam.IRole
  /** Docstrings */
  readonly usages?: DockerRegistryUsage[];
}

/** Docstrings */
export enum DockerRegistryUsage {
  SYNTH,
  SELF_UPDATE,
  ASSET_PUBLISHING,
};

/** Docstrings */
class ExternalDockerRegistry extends DockerRegistry {
  constructor(public readonly registryDomain: string, private readonly opts: ExternalDockerRegistryOptions) {
    super();
  }

  public grantRead(grantee: iam.IGrantable) {
    if (this.opts.assumeRole) {
      grantee.grantPrincipal.addToPrincipalPolicy(new iam.PolicyStatement({
        actions: ['sts:AssumeRole'],
        resources: [this.opts.assumeRole.roleArn],
      }));
    }
    const role = this.opts.assumeRole ?? grantee;
    this.opts.secret.grantRead(role);
  }

  /**
   * Docstrings
   * @internal
   */
  public _renderCdkAssetsConfig(): DockerRegistryCredentialSource {
    return {
      secretsManagerSecretId: this.opts.secret.secretArn,
      secretsUsernameField: this.opts.secretUsernameField,
      secretsPasswordField: this.opts.secretPasswordField,
      assumeRoleArn: this.opts.assumeRole?.roleArn,
    };
  }
}

/** Docstrings */
class EcrDockerRegistry extends DockerRegistry {
  public readonly registryDomain: string;

  constructor(private readonly repositories: ecr.IRepository[], private readonly opts: EcrDockerRegistryOptions) {
    super();

    if (repositories.length === 0) {
      throw new Error('must supply at least one `ecr.IRepository` to create an `EcrDockerRegistry`');
    }
    this.registryDomain = Fn.select(0, Fn.split('/', repositories[0].repositoryUri));
  }

  public grantRead(grantee: iam.IGrantable) {
    if (this.opts.assumeRole) {
      grantee.grantPrincipal.addToPrincipalPolicy(new iam.PolicyStatement({
        actions: ['sts:AssumeRole'],
        resources: [this.opts.assumeRole.roleArn],
      }));
    }
    const role = this.opts.assumeRole ?? grantee;
    this.repositories.forEach(repo => repo.grantPull(role));
  }

  /**
   * does stuff
   * @internal
   */
  public _renderCdkAssetsConfig(): DockerRegistryCredentialSource {
    return {
      ecrRepository: true,
      assumeRoleArn: this.opts.assumeRole?.roleArn,
    };
  }
}

interface DockerRegistryCredentialSource {
  readonly secretsManagerSecretId?: string;
  readonly secretsUsernameField?: string;
  readonly secretsPasswordField?: string;
  readonly ecrRepository?: boolean;
  readonly assumeRoleArn?: string;
}

export function dockerRegistriesInstallCommands(registries?: DockerRegistry[], osType?: ec2.OperatingSystemType): string[] {
  if (!registries || registries.length === 0) { return []; }

  const domainCredentials = registries.reduce(function(map: Record<string, any>, registry) {
    map[registry.registryDomain] = registry._renderCdkAssetsConfig();
    return map;
  }, {});
  const cdkAssetsConfigFile = {
    version: '1.0',
    domainCredentials,
  };

  if (osType === ec2.OperatingSystemType.WINDOWS) {
    return [
      'aws codeartifact login --tool npm --domain cdk1 --repository CDKPackageInjector', // TMP NLYNCH TESTING
      'mkdir %USERPROFILE%\\.cdk',
      `echo '${JSON.stringify(cdkAssetsConfigFile)}' > %USERPROFILE%\\.cdk\\cdk-docker-creds.json`,
    ];
  } else {
    return [
      'aws codeartifact login --tool npm --domain cdk1 --repository CDKPackageInjector', // TMP NLYNCH TESTING
      'mkdir $HOME/.cdk',
      `echo '${JSON.stringify(cdkAssetsConfigFile)}' > $HOME/.cdk/cdk-docker-creds.json`,
    ];
  }
}
