// Sentry Content Aggregator Configuration
export const config = {
  // YouTube Data API v3 Key (required for real YouTube integration)
  // Get your API key from: https://console.cloud.google.com/
  youtube: {
    apiKey: process.env.YOUTUBE_API_KEY || '',
    channelId: 'UCP_sweTJ0DQmMlpvNSOpEJg', // Sentry's official YouTube channel ID
    maxResults: 50,
  },
  
  // GitHub Integration
  github: {
    token: process.env.GITHUB_TOKEN || '',
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET || '',
    repository: 'getsentry/sentry-docs',
  },
  
  // OpenAI Integration
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    model: 'gpt-3.5-turbo',
  },
  
  // Blog configuration
  blog: {
    rssUrl: 'https://blog.sentry.io/feed.xml',
    maxPosts: 100,
  },
  
  // Content filtering
  content: {
    daysToShow: 90, // Show content from the last X days
    maxContentItems: 200,
  },
  
  // Cache settings
  cache: {
    ttl: 3600, // Cache TTL in seconds
    maxSize: 100, // Maximum cache entries
  },
  
  // Rate limiting
  rateLimit: {
    requests: 100, // Max requests per window
    windowMs: 900000, // Window in milliseconds (15 minutes)
  },
  
  // App settings
  app: {
    name: 'Sentry Content Aggregator',
    description: 'Latest content from Sentry blog and YouTube channel',
    url: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  },
};

// Debug logging
console.log('Config loaded - YouTube API key present:', !!config.youtube.apiKey);
console.log('Environment variables:', {
  hasYouTubeApiKey: !!process.env.YOUTUBE_API_KEY,
  NODE_ENV: process.env.NODE_ENV,
});

export default config;
