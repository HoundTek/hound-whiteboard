// Main App component
function App() {
  const [activeTab, setActiveTab] = React.useState(0);
  const [showAppearanceSubpage, setShowAppearanceSubpage] = React.useState(false);
  const [showLanguageSubpage, setShowLanguageSubpage] = React.useState(false);
  const [languageVersion, setLanguageVersion] = React.useState(0);
  const [themeVersion, setThemeVersion] = React.useState(0);
  const [animationClass, setAnimationClass] = React.useState('');
  
  // Track current page for animation
  const currentPageRef = React.useRef(0);
  const contentRef = React.useRef(null);
  
  // Scroll position management
  const scrollPositionsRef = React.useRef({});
  const prevPageIdRef = React.useRef(null);
  
  const getIconPath = (iconName) => {
    // Use themeManager to get icon path from current icon pack
    return window.themeManager.getIconPath(iconName);
  };
  
  const t = (keyPath, params = {}) => {
    // Use localeManager to get translation
    return window.localeManager.t(keyPath, params);
  };
  
  const tabs = [
    { id: 0, title: t('tabs.start'), icon: 'add', component: window.Page1 },
    { id: 1, title: t('tabs.settings'), icon: 'setting', component: window.Page2 },
    { id: 2, title: t('tabs.help'), icon: 'help', component: window.Page3 },
    { id: 3, title: t('tabs.mine'), icon: 'user', component: window.Page4 }
  ];
  
  // Get current page ID
  const getCurrentPageId = () => {
    if (showAppearanceSubpage) return 'appearance';
    if (showLanguageSubpage) return 'language';
    return activeTab;
  };
  
  // Save scroll position for current page
  const saveScrollPosition = (pageId) => {
    const scrollY = window.scrollY || document.documentElement.scrollTop;
    scrollPositionsRef.current[pageId] = scrollY;
  };
  
  // Restore scroll position for target page
  const restoreScrollPosition = (pageId) => {
    const savedPosition = scrollPositionsRef.current[pageId];
    if (savedPosition !== undefined) {
      window.scrollTo(0, savedPosition);
    } else {
      window.scrollTo(0, 0);
    }
  };
  
  // Clear scroll position for a page
  const clearScrollPosition = (pageId) => {
    delete scrollPositionsRef.current[pageId];
  };
  
  // Navigate to appearance subpage
  const navigateToAppearance = () => {
    const fromPage = getCurrentPageId();
    saveScrollPosition(fromPage);
    setShowAppearanceSubpage(true);
    clearScrollPosition('appearance');
    const animationType = window.animationUtils.getAnimationType(fromPage, 'appearance');
    setAnimationClass(`anim-${animationType}`);
  };
  
  // Navigate back from appearance subpage
  const navigateBackFromAppearance = () => {
    const fromPage = getCurrentPageId();
    clearScrollPosition(fromPage);
    setShowAppearanceSubpage(false);
    const animationType = window.animationUtils.getAnimationType(fromPage, 1);
    setAnimationClass(`anim-${animationType}`);
  };
  
  // Navigate to language subpage
  const navigateToLanguage = () => {
    const fromPage = getCurrentPageId();
    saveScrollPosition(fromPage);
    setShowLanguageSubpage(true);
    clearScrollPosition('language');
    const animationType = window.animationUtils.getAnimationType(fromPage, 'language');
    setAnimationClass(`anim-${animationType}`);
  };
  
  // Navigate back from language subpage
  const navigateBackFromLanguage = () => {
    const fromPage = getCurrentPageId();
    clearScrollPosition(fromPage);
    setShowLanguageSubpage(false);
    const animationType = window.animationUtils.getAnimationType(fromPage, 1);
    setAnimationClass(`anim-${animationType}`);
  };
  
  // Listen for language changes
  React.useEffect(() => {
    const handleLanguageChange = () => {
      setLanguageVersion(prev => prev + 1);
      // Recalculate layout after language change
      // Use setTimeout to ensure layout is recalculated after React re-renders
      setTimeout(() => {
        requestAnimationFrame(() => {
          window.layoutUtils.calculateOptimalColumns();
          window.scrollIndicatorUtils.updateScrollIndicator();
          window.tabUtils.updateTabSlider();
        });
      }, 0);
    };
    
    window.addEventListener('languageChanged', handleLanguageChange);
    
    return () => {
      window.removeEventListener('languageChanged', handleLanguageChange);
    };
  }, []);
  
  // Listen for theme changes
  React.useEffect(() => {
    const handleThemeChange = () => {
      setThemeVersion(prev => prev + 1);
    };
    
    window.addEventListener('themeChanged', handleThemeChange);
    
    return () => {
      window.removeEventListener('themeChanged', handleThemeChange);
    };
  }, []);
  
  // Listen for config updates from other windows
  React.useEffect(() => {
    if (!window.electronAPI) return;
    
    const handleConfigUpdate = async (data) => {
      if (data.type === 'theme') {
        await window.themeManager.loadTheme(data.value);
        setThemeVersion(prev => prev + 1);
      } else if (data.type === 'iconPack') {
        await window.themeManager.loadIcons(data.value);
        setThemeVersion(prev => prev + 1);
      } else if (data.type === 'locale') {
        await window.localeManager.loadLocale(data.value);
        setLanguageVersion(prev => prev + 1);
      }
    };
    
    window.electronAPI.onConfigUpdate(handleConfigUpdate);
    
    return () => {
      window.electronAPI.removeConfigUpdateListener();
    };
  }, []);
  
  // Handle scroll position on page change
  React.useEffect(() => {
    const currentPageId = getCurrentPageId();
    
    // Restore scroll position after page change
    restoreScrollPosition(currentPageId);
    
    // Update scroll indicator
    requestAnimationFrame(() => {
      window.scrollIndicatorUtils.updateScrollIndicator();
    });
  }, [activeTab, showAppearanceSubpage, showLanguageSubpage]);
  
  // Add event listeners for tab button hover
  React.useEffect(() => {
    const cleanup = window.tabUtils.addTabButtonHoverListeners();
    
    // Clean up event listeners
    return cleanup;
  }, [activeTab]);
  
  // Apply optimal columns to button containers and handle scroll indicator
  React.useEffect(() => {
    // Calculate columns when tab changes
    const calculateAfterRender = () => {
      // Use requestAnimationFrame instead of setTimeout for smoother rendering
      requestAnimationFrame(() => {
        window.layoutUtils.calculateOptimalColumns();
        window.scrollIndicatorUtils.updateScrollIndicator();
        window.tabUtils.updateTabSlider();
      });
    };
    
    calculateAfterRender();
    
    // Add resize event listener with debounce to avoid too frequent calculations
    const debouncedCalculate = () => {
      requestAnimationFrame(() => {
        window.layoutUtils.calculateOptimalColumns();
        window.scrollIndicatorUtils.updateScrollIndicator();
        window.tabUtils.updateTabSlider();
      });
    };
    
    window.addEventListener('resize', debouncedCalculate);
    window.addEventListener('scroll', window.scrollIndicatorUtils.updateScrollIndicator);
    
    // Initialize scroll indicator drag functionality
    window.scrollIndicatorUtils.initScrollIndicatorDrag();
    
    // Clean up event listeners
    return () => {
      window.removeEventListener('resize', debouncedCalculate);
      window.removeEventListener('scroll', window.scrollIndicatorUtils.updateScrollIndicator);
    };
  }, [activeTab, showAppearanceSubpage, showLanguageSubpage, languageVersion]);
  
  const renderPageContent = () => {
    let containerClass = 'page-content';
    let pageContent = null;
    
    if (showAppearanceSubpage) {
      pageContent = React.createElement(window.AppearanceSubpage, { 
        key: 'appearance', 
        onBack: navigateBackFromAppearance 
      });
    } else if (showLanguageSubpage) {
      pageContent = React.createElement(window.LanguageSubpage, { 
        key: 'language', 
        onBack: navigateBackFromLanguage 
      });
    } else {
      const CurrentPage = tabs[activeTab].component;
      if (activeTab === 0) {
        containerClass = 'page-content page1-content';
      }
      if (activeTab === 1) {
        pageContent = React.createElement(CurrentPage, { 
          key: activeTab,
          onNavigateToAppearance: navigateToAppearance,
          onNavigateToLanguage: navigateToLanguage
        });
      } else {
        pageContent = React.createElement(CurrentPage, { key: activeTab });
      }
    }
    
    return React.createElement('div', { 
      className: `${containerClass} ${animationClass}`.trim(),
      ref: contentRef,
      onAnimationEnd: () => setAnimationClass('')
    }, pageContent);
  };
  
  return React.createElement('div', { className: 'app' }, [
    React.createElement('div', { key: 'content', className: 'content' }, renderPageContent()),
    React.createElement('div', { key: 'tab-container', className: 'tab-container' }, 
      tabs.map(tab => 
        React.createElement('button', {
          key: tab.id,
          className: `tab-button ${activeTab === tab.id ? 'active' : ''}`,
          onClick: () => {
            if (activeTab !== tab.id) {
              const fromPage = getCurrentPageId();
              saveScrollPosition(fromPage);
              clearScrollPosition(tab.id);
              const animationType = window.animationUtils.getAnimationType(fromPage, tab.id);
              setAnimationClass(`anim-${animationType}`);
              setActiveTab(tab.id);
              setShowAppearanceSubpage(false);
              setShowLanguageSubpage(false);
            }
          }
        }, [
          React.createElement('img', {
            key: `icon-${tab.id}`,
            src: getIconPath(tab.icon),
            alt: tab.title,
            className: 'tab-icon'
          }),
          React.createElement('span', { key: `text-${tab.id}` }, tab.title)
        ])
      )
    )
  ]);
}

// Export for use in index.html
window.App = App;