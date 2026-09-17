#!/usr/bin/env node
const { runOnce, options } = require('./poll-github');
runOnce(options).then(count => console.log(`Delivered ${count} commits`)).catch(error => { console.error(error.message); process.exitCode = 1; });
