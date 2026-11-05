'use strict';

const { execSync } = require('child_process');

/**
 * sharp (miniaturas de fotos) trae binarios nativos por sistema operativo. En el Mac npm instala
 * los de macOS, pero las lambdas corren en Linux x64: antes de empaquetar se instalan los de
 * Linux y al terminar se restauran los del equipo para que el backend local siga funcionando.
 */
class SharpLinuxPlugin {
  constructor(serverless) {
    this.log = (msg) => serverless.cli.log(`[sharp-linux] ${msg}`);
    this.hooks = {
      'before:package:createDeploymentArtifacts': () => this.install('--os=linux --cpu=x64 --libc=glibc', 'binarios de Linux para las lambdas'),
      'after:package:createDeploymentArtifacts': () => this.install('', 'binarios de este equipo'),
    };
  }

  install(flags, label) {
    if (process.platform === 'linux' && process.arch === 'x64') return;
    this.log(`Instalando sharp con ${label}...`);
    execSync(`npm install --no-save --no-audit --no-fund ${flags}`.trim(), { stdio: 'inherit' });
  }
}

module.exports = SharpLinuxPlugin;
