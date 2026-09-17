#!/usr/bin/env node

/**
 * Test script for GitHub integration
 * This script tests the GitHub API integration and manual trigger
 */

const axios = require('axios');

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

async function testGitHubIntegration() {
  console.log('🧪 Testing GitHub Integration\n');
  
  try {
    // Test 1: Check if the trigger endpoint is accessible
    console.log('1. Testing trigger endpoint accessibility...');
    const triggerResponse = await axios.get(`${BASE_URL}/api/github/trigger`);
    console.log('✅ Trigger endpoint accessible:', triggerResponse.data.message);
    
    // Test 2: Test manual trigger (if GitHub token is configured)
    console.log('\n2. Testing manual trigger...');
    try {
      const triggerPostResponse = await axios.post(`${BASE_URL}/api/github/trigger`, {}, { headers: { Authorization: `Bearer ${process.env.GITHUB_TRIGGER_SECRET || ''}` } });
      console.log('✅ Manual trigger successful:', triggerPostResponse.data.message);
      console.log(`   Commits processed: ${triggerPostResponse.data.commitsProcessed}`);
      
      if (triggerPostResponse.data.results && triggerPostResponse.data.results.length > 0) {
        console.log('   Recent docs changes found:');
        triggerPostResponse.data.results.slice(0, 3).forEach((result, index) => {
          console.log(`   ${index + 1}. ${result.sha} (processed: ${result.processed})`);
        });
      }
    } catch (error) {
      if (error.response?.status === 400) {
        console.log('⚠️  Manual trigger failed: GitHub token not configured');
        console.log('   This is expected if you haven\'t set up the environment variables yet');
      } else {
        throw error;
      }
    }
    
    // Test 3: Check changelog API
    console.log('\n3. Testing changelog API...');
    const changelogResponse = await axios.get(`${BASE_URL}/api/docs`);
    console.log('✅ Changelog API accessible');
    console.log(`   Total changelog entries: ${changelogResponse.data.length}`);
    
    // Count different types of entries
    const sourceCounts = changelogResponse.data.reduce((acc, item) => {
      acc[item.source] = (acc[item.source] || 0) + 1;
      return acc;
    }, {});
    
    console.log('   Entry breakdown:', sourceCounts);
    
    // Test 4: Check for docs-specific entries
    const docsEntries = changelogResponse.data.filter(item => 
      item.commitId || item.aiSummary || item.filesChanged
    );
    
    if (docsEntries.length > 0) {
      console.log(`   Docs changelog entries: ${docsEntries.length}`);
      console.log('   Recent docs entry:', {
        title: docsEntries[0].title,
        author: docsEntries[0].author,
        filesChanged: docsEntries[0].filesChanged?.modified?.length || 0
      });
    } else {
      console.log('   No docs changelog entries found yet');
    }
    
    console.log('\n✅ All tests completed successfully!');
    console.log('\n📋 Next steps:');
    console.log('1. Set up your environment variables (.env.local)');
    console.log('2. Configure the GitHub webhook');
    console.log('3. Make a test commit to the sentry-docs repository');
    console.log('4. Check the changelog in your application');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    
    if (error.code === 'ECONNREFUSED') {
      console.log('\n💡 Make sure your development server is running:');
      console.log('   npm run dev');
    }
    
    if (error.response) {
      console.log('   Response status:', error.response.status);
      console.log('   Response data:', error.response.data);
    }
    
    process.exit(1);
  }
}

// Run the test
testGitHubIntegration();
