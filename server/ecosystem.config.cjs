module.exports = {
  apps: [
    {
      name: 'marineambroselli-rdv',
      cwd: __dirname,
      script: 'src/index.js',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '200M',
    },
  ],
};
