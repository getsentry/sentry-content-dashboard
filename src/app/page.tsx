'use client';

import { useState, useEffect, useCallback, useRef, memo } from 'react';
import * as Sentry from '@sentry/nextjs';
import Image from 'next/image';
import { type ContentItem, type ContentSource } from '../utils/content';
import { loadDashboardContent } from '../utils/loadDashboardContent';
import { CATEGORIES, getCategoryById, getCategoryName } from '../utils/categoryDetector';

// Custom hook for swirling animation
function useSwirlingAnimation(duration: number = 2000) {
  const [isAnimating, setIsAnimating] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsAnimating(false);
    }, duration);

    return () => clearTimeout(timer);
  }, [duration]);

  return isAnimating;
}

// Hamburger menu icon component
const HamburgerIcon = ({ isOpen }: { isOpen: boolean }) => (
  <div className="flex flex-col justify-center items-center w-6 h-6">
    <span className={`block w-5 h-0.5 bg-green-400 transition-all duration-300 ${isOpen ? 'rotate-45 translate-y-1.5' : ''}`}></span>
    <span className={`block w-5 h-0.5 bg-green-400 transition-all duration-300 mt-1 ${isOpen ? 'opacity-0' : ''}`}></span>
    <span className={`block w-5 h-0.5 bg-green-400 transition-all duration-300 mt-1 ${isOpen ? '-rotate-45 -translate-y-1.5' : ''}`}></span>
  </div>
);

export default function Home() {
  const [content, setContent] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingSources, setPendingSources] = useState<ContentSource[]>([]);
  const currentContent = useRef<ContentItem[]>([]);
  const lastRefresh = useRef(0);
  const [failedSources, setFailedSources] = useState<ContentSource[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedFilter, setSelectedFilter] = useState<'all' | 'blog' | 'youtube' | 'docs' | 'changelog'>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  
  // Swirling animation for desktop header
  const isSwirling = useSwirlingAnimation(2500);

  const activeRequest = useRef<AbortController | null>(null);
  const fetchContent = useCallback(async (background = false) => {
    // Visibility and history restoration may fire together; share the in-flight load.
    if (activeRequest.current || (background && Date.now() - lastRefresh.current < 30000)) return;
    const controller = new AbortController();
    activeRequest.current = controller;
    try {
      if (!background && !currentContent.current.length) setLoading(true);
      setPendingSources(['blog', 'youtube', 'docs', 'changelog']);
      const started = performance.now();
      let firstVisible = false;
      const result = await Sentry.startSpan({ name: 'Load dashboard content', op: 'function' },
        () => loadDashboardContent(controller.signal, progress => {
          if (controller.signal.aborted) return;
          currentContent.current = progress.items;
          setContent(progress.items);
          setFailedSources(progress.failedSources);
          setPendingSources(progress.pendingSources);
          if (progress.items.length || !progress.pendingSources.length) {
            setLoading(false);
            setError(null);
          }
          if (!firstVisible && progress.items.length) {
            firstVisible = true;
            Sentry.logger.info('First dashboard content visible', { durationMs: performance.now() - started });
          }
        }, { refresh: !background, initialItems: currentContent.current }));
      if (controller.signal.aborted) return;
      setFailedSources(result.failedSources);
      if (result.failedSources.length === 4 && !result.items.length) throw new Error('All content sources are unavailable');
      setError(null);
      currentContent.current = result.items;
      setContent(result.items);
      lastRefresh.current = Date.now();
      if (result.failedSources.length) {
        Sentry.logger.warn('Some content sources unavailable', { sources: result.failedSources.join(',') });
      }
      Sentry.logger.info('Dashboard content loaded', { itemCount: result.items.length });
    } catch (err) {
      if (controller.signal.aborted) return;
      Sentry.captureException(err);
      Sentry.logger.error('Dashboard content loading failed');
      console.error('Error fetching content:', err);
      // Keep the existing list visible if a background refresh fails.
      if (!currentContent.current.length) setError('Failed to fetch content. Please try again later.');
      else setFailedSources(['blog', 'youtube', 'docs', 'changelog']);
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        setLoading(false);
        setPendingSources([]);
      }
    }
  }, []);

  useEffect(() => {
    void fetchContent();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void fetchContent(true);
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) void fetchContent(true);
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onPageShow);
      activeRequest.current?.abort();
      activeRequest.current = null;
    };
  }, [fetchContent]);

  const getContentStats = () => {
    const blogCount = content.filter(item => item.source === 'blog').length;
    const youtubeCount = content.filter(item => item.source === 'youtube').length;
    const docsCount = content.filter(item => item.source === 'docs').length;
    const changelogCount = content.filter(item => item.source === 'changelog').length;
    const totalCount = content.length;
    
    // Category statistics
    const categoryStats = CATEGORIES.map(category => ({
      id: category.id,
      name: category.name,
      count: content.filter(item => item.categories.includes(category.id)).length,
      color: category.color
    }));
    
    return { blogCount, youtubeCount, docsCount, changelogCount, totalCount, categoryStats };
  };

  const getFilteredContent = () => {
    let filtered = content;
    
    // Filter by source
    if (selectedFilter !== 'all') {
      filtered = filtered.filter(item => item.source === selectedFilter);
    }
    
    // Filter by category
    if (selectedCategory !== 'all') {
      filtered = filtered.filter(item => item.categories.includes(selectedCategory));
    }
    
    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(item => 
        item.title.toLowerCase().includes(query) ||
        item.description.toLowerCase().includes(query) ||
        (item.author && item.author.toLowerCase().includes(query)) ||
        item.categories.some(catId => {
          const category = getCategoryById(catId);
          return category && category.name.toLowerCase().includes(query);
        })
      );
    }
    
    return filtered;
  };

  const resetFilters = () => {
    setSelectedFilter('all');
    setSelectedCategory('all');
    setSearchQuery('');
    setIsMobileMenuOpen(false);
  };

  const handleFilterChange = (filter: 'all' | 'blog' | 'youtube' | 'docs' | 'changelog') => {
    setSelectedFilter(filter);
    setIsMobileMenuOpen(false);
  };

  const handleCategoryChange = (category: string) => {
    setSelectedCategory(category);
    setIsMobileMenuOpen(false);
  };

  const stats = getContentStats();
  const filteredContent = getFilteredContent();

  if (loading) {
    return (
      <div className="min-h-screen pixel-bg flex items-center justify-center px-4">
        <div className="text-center">
          <div className="retro-scanner w-20 h-20 sm:w-24 sm:h-24 lg:w-32 lg:h-32 mx-auto mb-4 sm:mb-6 lg:mb-8 rounded-full"></div>
          <div className="pixel-text text-2xl sm:text-3xl lg:text-4xl font-bold text-green-400 mb-2 sm:mb-4 font-['Press_Start_2P']">
            LOADING...
          </div>
          <div className="text-cyan-400 text-sm sm:text-lg lg:text-xl font-['VT323'] px-2">
            Fetching Sentry content from the matrix...
          </div>
          <div className="mt-6 sm:mt-8 flex space-x-2 justify-center">
            <div className="w-2 sm:w-3 h-2 sm:h-3 bg-green-400 rounded-full animate-pulse"></div>
            <div className="w-2 sm:w-3 h-2 sm:h-3 bg-blue-400 rounded-full animate-pulse" style={{animationDelay: '0.2s'}}></div>
            <div className="w-2 sm:w-3 h-2 sm:h-3 bg-red-400 rounded-full animate-pulse" style={{animationDelay: '0.4s'}}></div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen pixel-bg flex items-center justify-center px-4">
        <div className="text-center">
          <div className="text-red-400 text-4xl sm:text-6xl lg:text-8xl mb-4 sm:mb-6">⚠️</div>
          <h1 className="pixel-text-red text-xl sm:text-2xl lg:text-3xl font-bold mb-4 sm:mb-6 font-['Press_Start_2P']">
            SYSTEM ERROR
          </h1>
          <p className="text-red-300 mb-6 sm:mb-8 text-sm sm:text-lg lg:text-xl font-['VT323'] px-2">{error}</p>
          <button 
            onClick={() => void fetchContent()}
            className="retro-button px-4 sm:px-6 lg:px-8 py-2 sm:py-3 lg:py-4 text-sm sm:text-lg lg:text-xl font-['Press_Start_2P']"
          >
            RETRY CONNECTION
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pixel-bg">
      {pendingSources.length > 0 && (
        <div role="status" className="p-3 text-center text-cyan-200">Updating {pendingSources.join(', ')}…</div>
      )}
      {failedSources.length > 0 && (
        <div role="status" className="p-4 text-center text-yellow-200 bg-yellow-950">
          Showing available content. Could not refresh: {failedSources.join(', ')}.
          <button className="ml-3 underline" onClick={() => void fetchContent()}>Retry sources</button>
        </div>
      )}
      {/* Header */}
      <header className="pixel-border bg-retro-card/80 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 lg:py-8">
          <div className="text-center">
            <h1 className="pixel-text text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold text-green-400 mb-2 sm:mb-4 font-['Press_Start_2P'] leading-tight">
              <span className={`inline-block ${isSwirling ? 'animate-swirl-in' : ''}`}>SENTRY</span>{' '}
              <span className={`inline-block ${isSwirling ? 'animate-swirl-in-reverse' : ''}`}>CONTENT</span>{' '}
              <span className={`inline-block ${isSwirling ? 'animate-swirl-in' : ''}`}>TERMINAL</span>
            </h1>
            <p className="text-cyan-400 text-sm sm:text-lg lg:text-xl font-['VT323'] mb-4 sm:mb-6 px-2">
              Accessing the latest content from Sentry&apos;s ecosystem...
            </p>
            
            {/* Source Statistics - Hidden on Mobile & Tablet, Desktop Only */}
            <div className="hidden lg:grid grid-cols-5 gap-8 mb-8">
              <button 
                onClick={() => setSelectedFilter('all')}
                className="text-center group cursor-pointer transition-all duration-200 hover:scale-105 rounded-lg p-2"
              >
                <div className={`pixel-text text-4xl font-bold text-green-400 font-['Press_Start_2P'] ${isSwirling ? 'animate-swirl-in' : ''}`}>{stats.totalCount}</div>
                <div className="text-sm text-cyan-400 font-['VT323'] group-hover:text-green-400 transition-colors">TOTAL</div>
              </button>
              <button 
                onClick={() => setSelectedFilter('blog')}
                className="text-center group cursor-pointer transition-all duration-200 hover:scale-105 rounded-lg p-2"
              >
                <div className={`pixel-text-blue text-4xl font-bold text-blue-400 font-['Press_Start_2P'] ${isSwirling ? 'animate-swirl-in-left' : ''}`}>{stats.blogCount}</div>
                <div className="text-sm text-cyan-400 font-['VT323'] group-hover:text-blue-400 transition-colors">BLOG</div>
              </button>
              <button 
                onClick={() => setSelectedFilter('youtube')}
                className="text-center group cursor-pointer transition-all duration-200 hover:scale-105 rounded-lg p-2"
              >
                <div className={`pixel-text-red text-4xl font-bold text-red-400 font-['Press_Start_2P'] ${isSwirling ? 'animate-swirl-in-reverse' : ''}`}>{stats.youtubeCount}</div>
                <div className="text-sm text-cyan-400 font-['VT323'] group-hover:text-red-400 transition-colors">VIDEOS</div>
              </button>
              <button 
                onClick={() => setSelectedFilter('docs')}
                className="text-center group cursor-pointer transition-all duration-200 hover:scale-105 rounded-lg p-2"
              >
                <div className={`pixel-text text-4xl font-bold text-yellow-400 font-['Press_Start_2P'] ${isSwirling ? 'animate-swirl-in-right' : ''}`}>{stats.docsCount}</div>
                <div className="text-sm text-cyan-400 font-['VT323'] group-hover:text-yellow-400 transition-colors">DOCS</div>
              </button>
              <button 
                onClick={() => setSelectedFilter('changelog')}
                className="text-center group cursor-pointer transition-all duration-200 hover:scale-105 rounded-lg p-2"
              >
                <div className={`pixel-text text-4xl font-bold text-purple-400 font-['Press_Start_2P'] ${isSwirling ? 'animate-swirl-in' : ''}`}>{stats.changelogCount}</div>
                <div className="text-sm text-cyan-400 font-['VT323'] group-hover:text-purple-400 transition-colors">CHANGELOG</div>
              </button>
            </div>
            
            {/* Category Statistics - Hidden on Mobile & Tablet, Desktop Only */}
            <div className="hidden lg:grid grid-cols-5 gap-6">
              {stats.categoryStats.map((category, index) => (
                <button 
                  key={category.id} 
                  onClick={() => setSelectedCategory(category.id)}
                  className="text-center group cursor-pointer transition-all duration-200 hover:scale-105 rounded-lg p-2"
                >
                  <div className={`pixel-text text-2xl font-bold font-['Press_Start_2P'] ${category.color.replace('bg-', 'text-')} ${isSwirling ? 
                    index % 4 === 0 ? 'animate-swirl-in' : 
                    index % 4 === 1 ? 'animate-swirl-in-reverse' : 
                    index % 4 === 2 ? 'animate-swirl-in-left' : 
                    'animate-swirl-in-right' : ''}`}>
                    {category.count}
                  </div>
                  <div className={`text-xs text-cyan-400 font-['VT323'] leading-tight group-hover:${category.color.replace('bg-', 'text-')} transition-colors`}>
                    {category.name.toUpperCase()}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      {/* Search Bar */}
      <div className="bg-retro-card/70 backdrop-blur-sm border-b-2 border-cyan-400/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
          <div className="relative max-w-2xl mx-auto">
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="SEARCH ARTICLES, VIDEOS, DOCS..."
                className="w-full px-4 sm:px-6 py-3 sm:py-4 bg-retro-bg text-cyan-400 placeholder-cyan-700 border-2 border-cyan-400 rounded-lg font-['VT323'] text-sm sm:text-lg focus:outline-none focus:border-green-400 focus:ring-2 focus:ring-green-400/50 transition-all duration-200"
              />
              <div className="absolute right-2 sm:right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                <svg className="w-5 sm:w-6 h-5 sm:h-6 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
            </div>
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute -right-2 sm:right-0 top-1/2 -translate-y-1/2 translate-x-full ml-2 sm:ml-3 retro-button px-2 sm:px-3 py-2 sm:py-3 font-['Press_Start_2P'] text-xs bg-red-600 text-white hover:bg-red-500 transition-colors"
              >
                ✕
              </button>
            )}
          </div>
          {searchQuery && (
            <div className="text-center mt-3 text-cyan-400 font-['VT323'] text-sm sm:text-base">
              Searching for: <span className="text-green-400 font-bold">&quot;{searchQuery}&quot;</span>
            </div>
          )}
        </div>
      </div>

      {/* Filter Controls */}
      <div className="bg-retro-card/50 border-b-2 border-green-400">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          {/* Mobile Menu Button - Visible on Mobile & Tablet */}
          <div className="lg:hidden flex justify-center mb-4">
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="retro-button px-6 py-3 font-['Press_Start_2P'] text-sm bg-green-600 text-white hover:bg-green-500 transition-colors"
            >
              <div className="flex items-center space-x-2">
                <HamburgerIcon isOpen={isMobileMenuOpen} />
                <span>FILTERS</span>
              </div>
            </button>
          </div>

          {/* Mobile Filter Menu - Slide down animation */}
          <div className={`lg:hidden overflow-hidden transition-all duration-300 ease-in-out ${
            isMobileMenuOpen ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
          }`}>
            <div className="space-y-4 pb-4">
              {/* Source Filters - Mobile Stacked */}
              <div>
                <h3 className="text-cyan-400 font-['VT323'] text-sm mb-2 text-center">SOURCE FILTERS</h3>
                <div className="grid grid-cols-2 gap-2">
                                     <button
                     onClick={() => handleFilterChange('all')}
                     className={`retro-button px-3 py-2 font-['Press_Start_2P'] text-xs transition-all duration-200 ${
                       selectedFilter === 'all' 
                         ? 'bg-green-400 text-retro-bg shadow-lg shadow-green-400/50 scale-105 border-green-300' 
                         : 'hover:bg-green-400/20 hover:border-green-400/50'
                     }`}
                   >
                     ALL
                   </button>
                   <button
                     onClick={() => handleFilterChange('blog')}
                     className={`retro-button px-3 py-2 font-['Press_Start_2P'] text-xs transition-all duration-200 ${
                       selectedFilter === 'blog' 
                         ? 'bg-blue-400 text-retro-bg shadow-lg shadow-blue-400/50 scale-105 border-blue-300' 
                         : 'hover:bg-blue-400/20 hover:border-blue-400/50'
                     }`}
                   >
                     BLOG
                   </button>
                   <button
                     onClick={() => handleFilterChange('youtube')}
                     className={`retro-button px-3 py-2 font-['Press_Start_2P'] text-xs transition-all duration-200 ${
                       selectedFilter === 'youtube' 
                         ? 'bg-red-400 text-retro-bg shadow-lg shadow-red-400/50 scale-105 border-red-300' 
                         : 'hover:bg-red-400/20 hover:border-red-400/50'
                     }`}
                   >
                     VIDEO
                   </button>
                   <button
                     onClick={() => handleFilterChange('docs')}
                     className={`retro-button px-3 py-2 font-['Press_Start_2P'] text-xs transition-all duration-200 ${
                       selectedFilter === 'docs' 
                         ? 'bg-yellow-400 text-retro-bg shadow-lg shadow-yellow-400/50 scale-105 border-yellow-300' 
                         : 'hover:bg-yellow-400/20 hover:border-yellow-400/50'
                     }`}
                   >
                     DOCS
                   </button>
                   <button
                     onClick={() => handleFilterChange('changelog')}
                     className={`retro-button px-3 py-2 font-['Press_Start_2P'] text-xs transition-all duration-200 ${
                       selectedFilter === 'changelog' 
                         ? 'bg-purple-400 text-retro-bg shadow-lg shadow-purple-400/50 scale-105 border-purple-300' 
                         : 'hover:bg-purple-400/20 hover:border-purple-400/50'
                     }`}
                   >
                     CHANGELOG
                   </button>
                </div>
              </div>
              
              {/* Category Filters - Mobile Stacked */}
              <div>
                <h3 className="text-cyan-400 font-['VT323'] text-sm mb-2 text-center">CATEGORY FILTERS</h3>
                <div className="grid grid-cols-2 gap-2">
                                     <button
                     onClick={() => handleCategoryChange('all')}
                     className={`retro-button px-2 py-2 font-['Press_Start_2P'] text-xs transition-all duration-200 ${
                       selectedCategory === 'all' 
                         ? 'bg-green-400 text-retro-bg shadow-lg shadow-green-400/50 scale-105 border-green-300' 
                         : 'hover:bg-green-400/20 hover:border-green-400/50'
                     }`}
                   >
                     ALL CAT
                   </button>
                   {CATEGORIES.map((category) => (
                     <button
                       key={category.id}
                       onClick={() => handleCategoryChange(category.id)}
                       className={`retro-button px-2 py-2 font-['Press_Start_2P'] text-xs transition-all duration-200 ${
                         selectedCategory === category.id 
                           ? `${category.color} text-white shadow-lg scale-105 border-white/50` 
                           : `hover:bg-${category.color.replace('bg-', '')}/20 hover:border-${category.color.replace('bg-', '')}/50`
                       }`}
                     >
                       {category.name.length > 6 ? category.name.substring(0, 6).toUpperCase() : category.name.toUpperCase()}
                     </button>
                   ))}
                   <button
                     onClick={resetFilters}
                     className="retro-button px-2 py-2 font-['Press_Start_2P'] text-xs bg-gray-600 text-white hover:bg-gray-500 transition-all duration-200 hover:scale-105"
                   >
                     RESET
                   </button>
                </div>
              </div>
            </div>
          </div>

          {/* Desktop Filters - Hidden on Mobile & Tablet */}
          <div className="hidden lg:block">
            {/* Source Filters - Desktop Horizontal */}
            <div className="flex justify-center space-x-4 mb-4">
              <button
                onClick={() => setSelectedFilter('all')}
                className={`retro-button px-6 py-3 font-['Press_Start_2P'] text-sm transition-all duration-200 ${
                  selectedFilter === 'all' 
                    ? 'bg-green-400 text-retro-bg shadow-lg shadow-green-400/50 scale-105 border-green-300' 
                    : 'hover:bg-green-400/20 hover:border-green-400/50'
                }`}
              >
                ALL CONTENT
              </button>
              <button
                onClick={() => setSelectedFilter('blog')}
                className={`retro-button px-6 py-3 font-['Press_Start_2P'] text-sm transition-all duration-200 ${
                  selectedFilter === 'blog' 
                    ? 'bg-blue-400 text-retro-bg shadow-lg shadow-blue-400/50 scale-105 border-blue-300' 
                    : 'hover:bg-blue-400/20 hover:border-blue-400/50'
                }`}
              >
                BLOG POSTS
              </button>
              <button
                onClick={() => setSelectedFilter('youtube')}
                className={`retro-button px-6 py-3 font-['Press_Start_2P'] text-sm transition-all duration-200 ${
                  selectedFilter === 'youtube' 
                    ? 'bg-red-400 text-retro-bg shadow-lg shadow-red-400/50 scale-105 border-red-300' 
                    : 'hover:bg-red-400/20 hover:border-red-400/50'
                }`}
              >
                YOUTUBE VIDEOS
              </button>
              <button
                onClick={() => setSelectedFilter('docs')}
                className={`retro-button px-6 py-3 font-['Press_Start_2P'] text-sm transition-all duration-200 ${
                  selectedFilter === 'docs' 
                    ? 'bg-yellow-400 text-retro-bg shadow-lg shadow-yellow-400/50 scale-105 border-yellow-300' 
                    : 'hover:bg-yellow-400/20 hover:border-yellow-400/50'
                }`}
              >
                DOCUMENTATION
              </button>
              <button
                onClick={() => setSelectedFilter('changelog')}
                className={`retro-button px-6 py-3 font-['Press_Start_2P'] text-sm transition-all duration-200 ${
                  selectedFilter === 'changelog' 
                    ? 'bg-purple-400 text-retro-bg shadow-lg shadow-purple-400/50 scale-105 border-purple-300' 
                    : 'hover:bg-purple-400/20 hover:border-purple-400/50'
                }`}
              >
                CHANGELOG
              </button>
            </div>
            
            {/* Category Filters - Desktop Horizontal */}
            <div className="flex justify-center space-x-4">
              <button
                onClick={() => setSelectedCategory('all')}
                className={`retro-button px-4 py-2 font-['Press_Start_2P'] text-xs transition-all duration-200 ${
                  selectedCategory === 'all' 
                    ? 'bg-green-400 text-retro-bg shadow-lg shadow-green-400/50 scale-105 border-green-300' 
                    : 'hover:bg-green-400/20 hover:border-green-400/50'
                }`}
              >
                ALL CATEGORIES
              </button>
              {CATEGORIES.map((category) => (
                <button
                  key={category.id}
                  onClick={() => setSelectedCategory(category.id)}
                  className={`retro-button px-4 py-2 font-['Press_Start_2P'] text-xs transition-all duration-200 ${
                    selectedCategory === category.id 
                      ? `${category.color} text-white shadow-lg scale-105 border-white/50` 
                      : `hover:bg-${category.color.replace('bg-', '')}/20 hover:border-${category.color.replace('bg-', '')}/50`
                  }`}
                >
                  {category.name.toUpperCase()}
                </button>
              ))}
              <button
                onClick={resetFilters}
                className="retro-button px-4 py-2 font-['Press_Start_2P'] text-xs bg-gray-600 text-white hover:bg-gray-500 transition-all duration-200 hover:scale-105"
              >
                RESET
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Filter Summary */}
      {(selectedFilter !== 'all' || selectedCategory !== 'all' || searchQuery) && (
        <div className="bg-retro-card/30 border-b border-green-400/50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
            <div className="text-center">
              <div className="flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-4 text-cyan-400 font-['VT323'] text-xs sm:text-sm">
                <span>FILTERING:</span>
                <div className="flex flex-wrap justify-center gap-2">
                  {searchQuery && (
                    <span className="inline-block px-2 py-1 bg-cyan-600 text-white text-xs rounded font-['Press_Start_2P']">
                      SEARCH: {searchQuery.toUpperCase()}
                    </span>
                  )}
                  {selectedFilter !== 'all' && (
                    <span className="inline-block px-2 py-1 bg-blue-600 text-white text-xs rounded font-['Press_Start_2P']">
                      {selectedFilter.toUpperCase()}
                    </span>
                  )}
                  {selectedCategory !== 'all' && (
                    <span className="inline-block px-2 py-1 bg-yellow-600 text-white text-xs rounded font-['Press_Start_2P']">
                      {getCategoryName(selectedCategory).toUpperCase()}
                    </span>
                  )}
                </div>
                <span className="text-green-400">
                  {filteredContent.length} of {content.length} items
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Content Grid */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 lg:py-8">
        {filteredContent.length === 0 ? (
          <div className="text-center py-8 sm:py-12 lg:py-16">
            <div className="text-cyan-400 text-4xl sm:text-6xl lg:text-8xl mb-4 sm:mb-6">📭</div>
            <h2 className="pixel-text text-lg sm:text-xl lg:text-2xl font-bold text-green-400 mb-2 sm:mb-4 font-['Press_Start_2P']">
              NO CONTENT DETECTED
            </h2>
            <p className="text-cyan-400 text-sm sm:text-lg lg:text-xl font-['VT323']">
              No content available at the moment.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 lg:gap-8">
            {filteredContent.map((item) => (
              <ContentCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="pixel-border bg-retro-card/50 mt-8 sm:mt-12 lg:mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 text-center">
          <p className="text-cyan-400 font-['VT323'] text-sm sm:text-lg">
            SENTRY CONTENT TERMINAL v1.0 - Ready for deployment
          </p>
          <div className="mt-4 flex justify-center space-x-4">
            <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
            <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div>
            <div className="w-2 h-2 bg-red-400 rounded-full animate-pulse"></div>
          </div>
          <div className="mt-4 sm:mt-6 pt-4 border-t border-cyan-400/30">
            <a 
              href="/api/export/markdown" 
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center px-3 sm:px-4 py-2 text-xs sm:text-sm font-['VT323'] text-cyan-400 hover:text-green-400 transition-colors duration-200 border border-cyan-400/50 hover:border-green-400/50 rounded"
            >
              🤖 If you are a robot, click here for markdown!
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

const contentDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

const ContentCard = memo(function ContentCard({ item }: { item: ContentItem }) {
  const isYouTube = item.source === 'youtube';
  const isDocs = item.source === 'docs';
  const isChangelog = item.source === 'changelog';
  const publishedDate = contentDate.format(new Date(item.publishedAt));
  
  return (
    <div className={`bg-retro-card backdrop-blur-sm rounded-lg transition-all duration-300 hover:scale-105 ${
      isYouTube ? 'pixel-border-red' : 
      isDocs ? 'pixel-border' : 
      isChangelog ? 'pixel-border-purple' :
      'pixel-border-blue'
    }`}>
      {/* Thumbnail */}
      {isYouTube && item.thumbnail && (
        <div className="relative w-full h-32 sm:h-40 lg:h-48">
          <Image
            src={item.thumbnail} 
            alt={item.title}
            fill
            className="object-cover rounded-t-lg"
          />
          {item.duration && (
            <div className="absolute bottom-1 sm:bottom-2 right-1 sm:right-2 bg-black/90 text-white text-xs px-1 sm:px-2 py-1 rounded font-['VT323']">
              {item.duration}
            </div>
          )}
          <div className="absolute top-1 sm:top-2 left-1 sm:left-2">
            <span className="bg-red-500 text-white text-xs px-1 sm:px-2 py-1 rounded font-['VT323']">
              🎥 VIDEO
            </span>
          </div>
        </div>
      )}
      
      {/* Content */}
      <div className="p-3 sm:p-4 lg:p-6">
        {/* Source Badge */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-0 mb-3 sm:mb-4">
          <span className={`inline-flex items-center px-2 sm:px-3 py-1 rounded font-['VT323'] text-xs sm:text-sm font-bold ${
            isYouTube 
              ? 'bg-red-900 text-red-200 border-2 border-red-400' 
              : isDocs
              ? 'bg-yellow-900 text-yellow-200 border-2 border-yellow-400'
              : isChangelog
              ? 'bg-purple-900 text-purple-200 border-2 border-purple-400'
              : 'bg-blue-900 text-blue-200 border-2 border-blue-400'
          }`}>
            {isYouTube ? '🎥 YOUTUBE' : isDocs ? '📚 DOCS' : isChangelog ? '🗒️ CHANGELOG' : '📝 BLOG'}
          </span>
          <span className="text-xs text-cyan-400 font-['VT323']">{publishedDate}</span>
        </div>
        
        {/* Categories */}
        {item.categories && item.categories.length > 0 && (
          <div className="flex flex-wrap gap-1 sm:gap-2 mb-2 sm:mb-3">
            {item.categories.map((categoryId) => {
              const category = getCategoryById(categoryId);
              return category ? (
                <span
                  key={categoryId}
                  className={`inline-flex items-center px-1 sm:px-2 py-1 rounded text-xs font-bold font-['VT323'] ${category.color} text-white`}
                >
                  {category.name.length > 8 ? category.name.substring(0, 8) + '...' : category.name}
                </span>
              ) : null;
            })}
          </div>
        )}
        
        {/* Title */}
        <h3 className={`text-sm sm:text-base lg:text-lg font-bold mb-2 sm:mb-3 line-clamp-2 font-['VT323'] ${
          isYouTube ? 'text-red-200' : 
          isDocs ? 'text-yellow-200' : 
          'text-blue-200'
        }`}>
          {item.title}
        </h3>
        
        {/* Description */}
        {item.description && (
          <p className="text-cyan-300 text-xs sm:text-sm mb-3 sm:mb-4 line-clamp-3 font-['VT323']">
            {item.description}
          </p>
        )}
        
        {/* Author */}
        {item.author && (
          <p className="text-xs text-cyan-400 mb-3 sm:mb-4 font-['VT323']">By {item.author}</p>
        )}
        
        {/* Link */}
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className={`retro-button inline-flex items-center px-3 sm:px-4 lg:px-6 py-2 sm:py-3 rounded-lg text-xs sm:text-sm font-bold font-['Press_Start_2P'] transition-all duration-200 ${
            isYouTube
              ? 'border-red-400 text-red-400 hover:bg-red-400 hover:text-retro-bg'
              : isDocs
              ? 'border-yellow-400 text-yellow-400 hover:bg-yellow-400 hover:text-retro-bg'
              : isChangelog
              ? 'border-purple-400 text-purple-400 hover:bg-purple-400 hover:text-retro-bg'
              : 'border-blue-400 text-blue-400 hover:bg-blue-400 hover:text-retro-bg'
          }`}
        >
          {isYouTube ? 'WATCH' : isDocs ? 'READ' : isChangelog ? 'VIEW' : 'READ'}
          <svg className="ml-1 sm:ml-2 w-3 sm:w-4 h-3 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      </div>
    </div>
  );
});
