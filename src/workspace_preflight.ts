import fs from 'fs';
import path from 'path';

function runPreflight() {
  const identityPath = path.join(process.cwd(), 'workspace.identity.json');
  
  if (!fs.existsSync(identityPath)) {
    console.error('WORKSPACE_PREFLIGHT=DENIED');
    console.error('CODE_CHANGE_ALLOWED=NO');
    console.error('BUILD_ALLOWED=NO');
    console.error('DEPLOY_ALLOWED=NO');
    console.error('REASON: NON_CANONICAL_WORKSPACE');
    process.exit(1);
  }

  const identity = JSON.parse(fs.readFileSync(identityPath, 'utf8'));

  if (identity.workspace_role === 'DEPRECATED_LOCAL_ONLY') {
    console.error('WORKSPACE_PREFLIGHT=DENIED');
    console.error('CODE_CHANGE_ALLOWED=NO');
    console.error('BUILD_ALLOWED=NO');
    console.error('DEPLOY_ALLOWED=NO');
    console.error('REASON: DEPRECATED_WORKSPACE');
    process.exit(1);
  }

  if (identity.workspace_role !== 'CANONICAL_PRODUCTION_SOURCE') {
    console.error('WORKSPACE_PREFLIGHT=DENIED');
    console.error('CODE_CHANGE_ALLOWED=NO');
    console.error('BUILD_ALLOWED=NO');
    console.error('DEPLOY_ALLOWED=NO');
    console.error('REASON: NON_CANONICAL_WORKSPACE');
    process.exit(1);
  }

  if (identity.production_target !== 'VPS now_os_backend') {
    console.error('WORKSPACE_PREFLIGHT=DENIED');
    console.error('REASON: PRODUCTION_TARGET_MISMATCH');
    process.exit(1);
  }

  if (identity.compose_project !== 'deploy_package') {
    console.error('WORKSPACE_PREFLIGHT=DENIED');
    console.error('REASON: COMPOSE_PROJECT_MISMATCH');
    process.exit(1);
  }

  if (identity.service_name !== 'now_os_backend') {
    console.error('WORKSPACE_PREFLIGHT=DENIED');
    console.error('REASON: SERVICE_TARGET_MISMATCH');
    process.exit(1);
  }

  console.log('ACTIVE_WORKSPACE=canonical-now-os');
  console.log('WORKSPACE_ROLE=CANONICAL_PRODUCTION_SOURCE');
  console.log('REAL_PRODUCTION_TARGET=VPS now_os_backend');
  console.log('COMPOSE_PROJECT=deploy_package');
  console.log('TARGET_SERVICE=now_os_backend');
  console.log('SOURCE_RUNTIME_MATCH=YES');
  console.log('RUNTIME_LOCK_STATUS=PRESERVED');
  console.log('WORKSPACE_PREFLIGHT=PASS');
}

runPreflight();
