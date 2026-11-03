import path from "path";

/**
 * Directory that owns this Employee001 installation's mutable state.
 *
 * The standalone Next server changes its working directory to its own bundle,
 * so CLI installs pass EMPLOYEE001_HOME to retain the directory the user chose
 * during setup. Deliberately read the environment on every call: tests and
 * long-lived processes may change it after this module has loaded.
 */
export function appHome(): string {
  const configuredHome = process.env.EMPLOYEE001_HOME;
  return configuredHome ? path.resolve(configuredHome) : process.cwd();
}

export function dataDir(...parts: string[]): string {
  return path.join(appHome(), "data", ...parts);
}

/** Where keys saved in Settings go: EMPLOYEE001_ENV_FILE when set (the Docker
 *  image points it at the data volume), else the install's own `.env`. */
export function envFilePath(): string {
  const configured = process.env.EMPLOYEE001_ENV_FILE;
  return configured ? path.resolve(configured) : path.join(appHome(), ".env");
}
