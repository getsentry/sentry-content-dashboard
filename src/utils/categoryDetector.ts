export interface Category {
  id: string;
  name: string;
  color: string;
  keywords: string[];
  description: string;
}

export const CATEGORIES: Category[] = [
  {
    id: 'gaming',
    name: 'Gaming',
    color: 'bg-purple-600',
    keywords: [
      'unity', 'godot', 'game', 'gaming', 'player', 'play', 'gameplay', 'sdk', 'crash', 'performance',
      'mobile game', 'console', 'steam', 'epic', 'nintendo', 'playstation', 'xbox', 'indie game',
      'game engine', 'rendering', 'physics', 'animation', 'audio', 'networking', 'multiplayer'
    ],
    description: 'Content related to game development, gaming SDKs, and game performance'
  },
  {
    id: 'mobile',
    name: 'Mobile',
    color: 'bg-blue-600',
    keywords: [
      'ios', 'android', 'mobile', 'app', 'smartphone', 'tablet', 'flutter', 'react native', 'swift',
      'kotlin', 'java', 'objective-c', 'mobile sdk', 'app store', 'google play', 'mobile performance',
      'mobile crash', 'mobile analytics', 'mobile monitoring', 'mobile debugging', 'mobile development'
    ],
    description: 'Content related to mobile app development, iOS/Android SDKs, and mobile performance'
  },
  {
    id: 'web',
    name: 'Web',
    color: 'bg-green-600',
    keywords: [
      'web', 'javascript', 'typescript', 'react', 'vue', 'angular', 'node.js', 'next.js', 'frontend',
      'backend', 'api', 'html', 'css', 'browser', 'chrome', 'firefox', 'safari', 'edge', 'webpack',
      'vite', 'npm', 'yarn', 'web performance', 'web vitals', 'lighthouse', 'pwa', 'spa'
    ],
    description: 'Content related to web development, frontend frameworks, and web performance'
  },
  {
    id: 'technical',
    name: 'Technical Content',
    color: 'bg-yellow-600',
    keywords: [
      'sdk', 'api', 'integration', 'monitoring', 'observability', 'debugging', 'performance', 'error',
      'crash', 'trace', 'span', 'metrics', 'alerting', 'dashboard', 'logging', 'tracing', 'profiling',
      'optimization', 'best practices', 'tutorial', 'how-to', 'guide', 'documentation', 'code example',
      'mcp', 'agent', 'ai', 'machine learning', 'llm', 'model', 'training', 'inference', 'seer'
    ],
    description: 'Technical tutorials, SDK documentation, and development guides'
  },
  {
    id: 'business',
    name: 'Business Content',
    color: 'bg-red-600',
    keywords: [
      'business', 'product', 'feature', 'announcement', 'release', 'update', 'roadmap', 'strategy',
      'customer', 'user', 'market', 'industry', 'partnership', 'acquisition', 'funding', 'growth',
      'analytics', 'insights', 'case study', 'success story', 'enterprise', 'team', 'company',
      'ai', 'artificial intelligence', 'machine learning', 'llm', 'agent', 'mcp', 'seer'
    ],
    description: 'Business announcements, product updates, and company news'
  }
];

export function detectCategories(title: string, description: string, source: string): string[] {
  const text = `${title} ${description}`.toLowerCase();
  const detectedCategories: string[] = [];
  
  // Check each category for keyword matches
  for (const category of CATEGORIES) {
    const matchCount = category.keywords.filter(keyword => 
      text.includes(keyword.toLowerCase())
    ).length;
    
    // If we find 2 or more keyword matches, consider it a match
    if (matchCount >= 2) {
      detectedCategories.push(category.id);
    }
  }
  
  // Source-based categorization as fallback
  if (detectedCategories.length === 0) {
    switch (source) {
      case 'changelog':
        detectedCategories.push('technical');
        break;
      case 'docs':
        detectedCategories.push('technical');
        break;
      case 'customers':
        // Customer stories are case studies, which read as business content.
        detectedCategories.push('business');
        break;
      case 'youtube':
        // YouTube content is often technical or business-related
        if (text.includes('tutorial') || text.includes('how') || text.includes('guide')) {
          detectedCategories.push('technical');
        } else {
          detectedCategories.push('business');
        }
        break;
      case 'blog':
        // Blog posts can be any category, but if no specific category detected, default to business
        detectedCategories.push('business');
        break;
    }
  }
  
  // Ensure we always have at least one category
  if (detectedCategories.length === 0) {
    detectedCategories.push('business');
  }
  
  return detectedCategories;
}

export function getCategoryById(id: string): Category | undefined {
  return CATEGORIES.find(cat => cat.id === id);
}

export function getCategoryColor(id: string): string {
  const category = getCategoryById(id);
  return category?.color || 'bg-gray-600';
}

export function getCategoryName(id: string): string {
  const category = getCategoryById(id);
  return category?.name || 'Other';
}
