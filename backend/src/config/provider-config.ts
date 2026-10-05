type Environment = Record<string, unknown>;

export type ProviderConfiguration = {
  nodeEnv: string;
  maps: {
    serverKey?: string;
    configured: boolean;
  };
  payments: {
    keyId?: string;
    keySecret?: string;
    webhookSecret?: string;
    configured: boolean;
  };
};

function value(environment: Environment, name: string) {
  const raw = environment[name];
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
}

const credentialPlaceholders = new Set([
  'replace_me',
  'replaceme',
  'change_me',
  'changeme',
  'placeholder',
  'your_key_here',
  'your_secret_here',
]);
const delimitedCredentialPlaceholder =
  /(?:^|[-./:_])(?:replace_me|replaceme|change_me|changeme|placeholder|your_key_here|your_secret_here)(?:$|[-./:_])/;

export function credentialValue(environment: Environment, name: string) {
  const configured = value(environment, name);

  if (!configured) {
    return undefined;
  }

  const normalized = configured.toLowerCase();
  if (
    credentialPlaceholders.has(normalized) ||
    delimitedCredentialPlaceholder.test(normalized) ||
    (normalized.startsWith('<') && normalized.endsWith('>'))
  ) {
    return undefined;
  }

  return configured;
}

function requireVariables(
  environment: Environment,
  names: string[],
  provider: string,
) {
  const missing = names.filter((name) => !credentialValue(environment, name));

  if (missing.length) {
    throw new Error(
      `${provider} requires ${missing.join(', ')}`,
    );
  }
}

export function getProviderConfiguration(
  environment: Environment = process.env,
): ProviderConfiguration {
  const nodeEnv = value(environment, 'NODE_ENV') ?? 'unspecified';
  const mapsKey = credentialValue(environment, 'GOOGLE_MAPS_SERVER_KEY');
  const razorpayKeyId = credentialValue(environment, 'RAZORPAY_KEY_ID');
  const razorpayKeySecret = credentialValue(environment, 'RAZORPAY_KEY_SECRET');
  const razorpayWebhookSecret = credentialValue(environment, 'RAZORPAY_WEBHOOK_SECRET');

  if (nodeEnv === 'production') {
    requireVariables(environment, ['GOOGLE_MAPS_SERVER_KEY'], 'Google Maps');
    requireVariables(
      environment,
      [
        'RAZORPAY_KEY_ID',
        'RAZORPAY_KEY_SECRET',
        'RAZORPAY_WEBHOOK_SECRET',
      ],
      'Razorpay',
    );
  }

  return {
    nodeEnv,
    maps: {
      serverKey: mapsKey,
      configured: Boolean(mapsKey),
    },
    payments: {
      keyId: razorpayKeyId,
      keySecret: razorpayKeySecret,
      webhookSecret: razorpayWebhookSecret,
      configured: Boolean(razorpayKeyId && razorpayKeySecret && razorpayWebhookSecret),
    },
  };
}

export function validateProviderConfiguration(environment: Environment) {
  getProviderConfiguration(environment);
  return { ...environment };
}
