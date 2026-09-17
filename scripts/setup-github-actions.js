#!/usr/bin/env node

/**
 * Setup script for GitHub Actions monitoring
 * This script helps you set up the monitoring repository
 */

const readline = require('readline');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function setup() {
  console.log('🚀 GitHub Actions Monitoring Setup\n');
  
  console.log('This script will help you set up a monitoring repository that watches');
  console.log('the getsentry/sentry-docs repository for changes.\n');
  
  const repoName = await question('Enter your monitoring repository name (e.g., sentry-docs-monitor): ');
  const webhookUrl = await question('Enter your webhook URL (e.g., https://your-domain.com/api/github/webhook): ');

  
  console.log('\n📋 Setup Steps:');
  console.log('1. Create a new repository on GitHub');
  console.log(`   Repository name: ${repoName}`);
  console.log('   Make it public (for free GitHub Actions)');
  console.log('   Don\'t initialize with README, .gitignore, or license\n');
  
  console.log('2. Clone the repository locally:');
  console.log(`   git clone https://github.com/YOUR_USERNAME/${repoName}.git`);
  console.log('   cd ' + repoName + '\n');
  
  console.log('3. Copy the monitoring files:');
  console.log('   Copy the contents of the monitoring-repo/ folder to your new repository\n');
  
  console.log('4. Add repository secrets:');
  console.log('   Go to Settings → Secrets and variables → Actions');
  console.log('   Add these secrets:');
  console.log(`   - WEBHOOK_URL: ${webhookUrl}`);
  console.log('   - WEBHOOK_SECRET: the secret you entered (also set GITHUB_WEBHOOK_SECRET on the app)\n');
  
  console.log('5. Enable GitHub Actions:');
  console.log('   Go to the Actions tab in your repository');
  console.log('   Click "I understand my workflows, go ahead and enable them"');
  console.log('   The workflow will start running automatically\n');
  
  console.log('6. Test the setup:');
  console.log('   Go to Actions → Monitor Sentry Docs Changes');
  console.log('   Click "Run workflow" to test manually\n');
  
  console.log('📁 Files to copy to your monitoring repository:');
  console.log('   - .github/workflows/monitor-sentry-docs.yml');
  console.log('   - poll-github.cjs');
  console.log('   - README.md\n');
  
  console.log('🔍 Monitoring:');
  console.log('- The workflow runs every 15 minutes');
  console.log('- Check the Actions tab to see when it runs');
  console.log('- View logs to see what commits are being processed');
  console.log('- The server checks each commit for documentation changes\n');
  
  console.log('🧪 Testing:');
  console.log('1. Make a test commit to the sentry-docs repository');
  console.log('2. Wait up to 15 minutes for the workflow to run');
  console.log('3. Check your application logs for webhook processing');
  console.log('4. Verify the changelog entry appears in your API\n');
  
  console.log('✅ Setup complete! Your monitoring repository is ready to deploy.');
  
  rl.close();
}

setup().catch(console.error);
