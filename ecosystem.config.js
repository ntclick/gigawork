module.exports = {
  apps: [
    {
      name: 'gigawork-workflow-worker',
      script: 'pnpm',
      args: 'run worker:workflow',
      cwd: '/opt/gigawork-v2',
      interpreter: 'none',
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'gigawork-chain-worker',
      script: 'pnpm',
      args: 'run worker:chain',
      cwd: '/opt/gigawork-v2',
      interpreter: 'none',
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
