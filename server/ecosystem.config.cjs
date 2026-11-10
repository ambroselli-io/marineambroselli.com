module.exports = {
  apps: [
    {
      name: 'marineambroselli-rdv',
      cwd: __dirname,
      script: 'src/index.js',
      env: { NODE_ENV: 'production', HOST: '127.0.0.1', PORT: '3210' },
      max_memory_restart: '200M',
    },
  ],
};
