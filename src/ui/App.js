const App = () => {
  const [currentPage, setCurrentPage] = React.useState('rowlist');
  const [capsuleValue, setCapsuleValue] = React.useState('rowlist');
  const [windowWidth, setWindowWidth] = React.useState(window.innerWidth);

  const pages = [
    { id: 'rowlist', label: '动态行列表' },
    { id: 'menubutton', label: '菜单按钮' },
    { id: 'layout', label: '并列布局' },
  ];

  React.useEffect(() => {
    const checkWidth = () => {
      setWindowWidth(window.innerWidth);
    };
    checkWidth();
    window.addEventListener('resize', checkWidth);
    return () => window.removeEventListener('resize', checkWidth);
  }, []);

  const rowListItems = [
    { id: 1, label: '项目 1', icon: '📱' },
    { id: 2, label: '项目 2', icon: '💻' },
    { id: 3, label: '项目 3', icon: '🎮' },
    { id: 4, label: '项目 4', icon: '📷' },
    { id: 5, label: '项目 5', icon: '🎵' },
    { id: 6, label: '项目 6', icon: '📚' },
    { id: 7, label: '项目 7', icon: '🎨' },
    { id: 8, label: '项目 8', icon: '🏃' },
  ];

  const rowListTotalWidth = rowListItems.length * 150 + (rowListItems.length - 1) * 16;
  const rowListShouldCenter = windowWidth > rowListTotalWidth + 32;

  const menuButtonItems = [
    { id: 1, text: '文档文件', icon: '📄' },
    { id: 2, text: '图片资源', icon: '🖼️' },
    { id: 3, text: '音频文件', icon: '🎵' },
  ];

  const renderRowListPage = () => {
    return React.createElement('div', { className: 'demo-section', style: { paddingBottom: '72px' } }, [
      React.createElement('h2', { key: 'title', className: 'demo-title' }, '动态行列表'),
      React.createElement('p', { key: 'desc' }, '宽度充足时内容居中，宽度不足时横向滚动。'),
      
      React.createElement('div', { 
        key: 'demo', 
        style: { 
          marginTop: '24px',
          position: 'relative',
          width: '100%',
        } 
      },
        React.createElement('div', {
          key: 'scroll-wrapper',
          style: {
            display: 'flex',
            overflowX: 'auto',
            overflowY: 'hidden',
            width: '100%',
            padding: '16px',
          }
        },
          React.createElement('div', {
            key: 'content-wrapper',
            style: {
              display: 'flex',
              gap: '16px',
              marginLeft: rowListShouldCenter ? 'auto' : 0,
              marginRight: rowListShouldCenter ? 'auto' : 0,
              flexShrink: 0,
            }
          }, rowListItems.map((item) =>
            window.DisplayBox({
              key: item.id,
              padding: '24px 32px',
              borderRadius: '12px',
              children: React.createElement('div', { style: { textAlign: 'center', whiteSpace: 'nowrap' } }, [
                React.createElement('div', { style: { fontSize: '32px', marginBottom: '8px' } }, item.icon),
                React.createElement('div', { style: { fontSize: '14px', fontWeight: 'bold' } }, item.label),
              ])
            })
          ))
        )
      )
    ]);
  };

  const renderMenuButtonPage = () => {
    return React.createElement('div', { className: 'demo-section', style: { paddingBottom: '72px' } }, [
      React.createElement('h2', { key: 'title', className: 'demo-title' }, '带菜单展示按钮'),
      React.createElement('p', { key: 'desc' }, '文字左对齐，菜单按钮右对齐。'),
      
      React.createElement('div', {
        key: 'demo',
        style: {
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '24px',
          marginTop: '24px',
          padding: '16px'
        }
      }, menuButtonItems.map((item) =>
        React.createElement('div', { key: item.id },
          window.DisplayBox({
            padding: '32px',
            borderRadius: '16px',
            children: React.createElement('div', { style: { textAlign: 'center', fontSize: '48px' } }, item.icon)
          }),
          React.createElement('div', {
            style: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginTop: '10px',
              padding: '0 4px'
            }
          }, [
            React.createElement('span', {
              style: { fontSize: '14px', color: 'var(--text-color, #333)', flex: 1, textAlign: 'left' }
            }, item.text),
            React.createElement('button', {
              onClick: () => alert('菜单: ' + item.text),
              style: {
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontSize: '20px',
                padding: '4px 8px',
              }
            }, '⋯')
          ])
        )
      ))
    ]);
  };

  const renderLayoutPage = () => {
    const isVertical = windowWidth < 768;
    const leftContent = React.createElement('div', {
      style: {
        padding: '24px',
        paddingRight: isVertical ? '24px' : '12px'
      }
    }, [
      React.createElement('div', { key: 'header', style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' } }, [
        React.createElement('h2', { style: { margin: 0, fontSize: '22px', color: '#333' } }, '并列布局演示'),
        React.createElement('div', { style: { fontSize: '14px', backgroundColor: '#e7f3ff', padding: '6px 12px', borderRadius: '6px', color: '#004085' } },
          windowWidth + 'px - ' + (windowWidth < 768 ? '垂直' : '并列')
        )
      ]),
      React.createElement('div', { key: 'intro', style: { borderLeft: '4px solid #667eea', paddingLeft: '16px', marginBottom: '24px' } }, [
        React.createElement('h3', { style: { margin: '0 0 10px 0', fontSize: '18px' } }, '介绍'),
        React.createElement('p', { style: { margin: '0 0 8px 0', fontSize: '14px', lineHeight: '1.7', color: '#555' } }, '响应式布局是现代Web设计的核心概念之一。它允许页面在不同尺寸的设备上都能提供最佳的用户体验，从大型桌面显示器到小型智能手机。'),
        React.createElement('p', { style: { margin: '0 0 8px 0', fontSize: '14px', lineHeight: '1.7', color: '#555' } }, '当窗口宽度大于768px时，左侧和右侧内容并列显示；当小于768px时，它们会垂直堆叠，确保在移动设备上也能正常阅读。'),
      ]),
      React.createElement('h3', { key: 'concepts-title', style: { margin: '0 0 15px 0', fontSize: '17px' } }, '核心概念'),
      React.createElement('div', { key: 'concepts', style: { display: 'flex', flexDirection: 'column', gap: '18px' } },
        [
          { 
            id: '1', 
            title: '1. 弹性布局', 
            content: '使用弹性布局（Flexbox）可以创建灵活的容器和子元素排列。它允许元素在可用空间内自动调整大小和位置，适应不同屏幕尺寸。Flexbox特别适合一维布局，比如导航栏、卡片网格或者像这个页面这样的左右分栏。' 
          },
          { 
            id: '2', 
            title: '2. 媒体查询', 
            content: '媒体查询是CSS3中的强大功能，允许我们根据设备特性应用不同的样式规则。最常用的是根据视口宽度来改变布局。在这个例子中，768px是我们的临界点，宽度大于这个值时使用水平布局，小于时使用垂直布局。' 
          },
          { 
            id: '3', 
            title: '3. 流动内容', 
            content: '内容应该像水流一样自然地适应容器的形状。这意味着避免固定宽度，使用百分比或相对单位，让文本和图片能够在不同容器中自然流动和重新排列。良好的内容流动性是优秀响应式设计的基础。' 
          },
          { 
            id: '4', 
            title: '4. 移动优先', 
            content: '移动优先设计是一种策略，先为小屏幕设计页面，然后逐步添加更大屏幕的优化。这种方法确保了移动设备的良好体验，而不是在后期才尝试压缩桌面版页面。它通常会产生更简洁、高效的代码。' 
          },
          { 
            id: '5', 
            title: '5. 可访问性', 
            content: '响应式设计不仅是关于视觉布局，还需要考虑可访问性。确保文本在小屏幕上仍然可读，交互元素有足够的点击区域，屏幕阅读器能够正确理解页面结构。一个真正优秀的网站对所有用户都是友好的。' 
          },
        ].map((item) =>
          React.createElement('div', {
            key: item.id,
            style: {
              padding: '20px',
              backgroundColor: '#f8f9fa',
              borderRadius: '12px',
              border: '1px solid #e9ecef'
            }
          }, [
            React.createElement('h4', { style: { margin: '0 0 12px 0', fontSize: '15px', color: '#333' } }, item.title),
            React.createElement('p', { style: { margin: 0, fontSize: '14px', lineHeight: '1.8', color: '#666' } }, item.content),
          ])
        )
      ),
      React.createElement('div', {
        key: 'summary',
        style: {
          marginTop: '28px',
          padding: '22px',
          backgroundColor: '#e8f5e9',
          borderRadius: '12px',
          border: '1px solid #a5d6a7'
        }
      }, [
        React.createElement('h4', { style: { margin: '0 0 12px 0', fontSize: '16px', color: '#2e7d32' } }, '💡 最佳实践总结'),
        React.createElement('ul', { style: { margin: 0, paddingLeft: '20px', fontSize: '14px', lineHeight: '1.8', color: '#388e3c' } }, [
          React.createElement('li', {}, '从最小屏幕开始设计，逐步增强'),
          React.createElement('li', {}, '使用相对单位而非固定像素'),
          React.createElement('li', {}, '测试真实设备，不要只依赖模拟器'),
          React.createElement('li', {}, '确保内容在所有尺寸下都可读可用'),
          React.createElement('li', {}, '保持代码简洁，避免过度工程化'),
        ])
      ])
    ]);

    const rightContent = React.createElement('div', {
      style: {
        padding: '24px',
        paddingLeft: isVertical ? '24px' : '12px'
      }
    }, [
      React.createElement('h3', { key: 'sidebar-title', style: { margin: '0 0 18px 0', fontSize: '18px', color: '#333' } }, '侧边栏'),
      React.createElement('div', {
        key: 'tip',
        style: {
          padding: '16px',
          backgroundColor: '#fff3cd',
          borderRadius: '10px',
          marginBottom: '20px',
          border: '1px solid #ffc107'
        }
      }, [
        React.createElement('h4', { style: { margin: '0 0 10px 0', fontSize: '14px', color: '#856404' } }, '📌 提示'),
        React.createElement('p', { style: { margin: 0, fontSize: '13px', lineHeight: '1.6', color: '#856404' } }, '调整窗口大小来观察响应式效果！'),
      ]),
      React.createElement('h4', { key: 'related-title', style: { margin: '0 0 12px 0', fontSize: '15px', color: '#333' } }, '相关文章'),
      React.createElement('div', { key: 'related', style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
        [
          { id: '4', title: '相关文章一', desc: '了解更多相关内容' },
          { id: '5', title: '相关文章二', desc: '拓展阅读材料' },
          { id: '6', title: '相关文章三', desc: '深入学习资源' },
        ].map((item) =>
          React.createElement('div', {
            key: item.id,
            style: {
              padding: '14px',
              backgroundColor: '#e7f3ff',
              borderRadius: '8px',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              border: '1px solid #b8daff'
            }
          }, [
            React.createElement('div', { style: { margin: '0 0 4px 0', fontSize: '14px', fontWeight: '500', color: '#004085' } }, item.title),
            React.createElement('div', { style: { margin: 0, fontSize: '12px', color: '#0069d9' } }, item.desc),
          ])
        )
      ),
      React.createElement('div', {
        key: 'stats',
        style: {
          marginTop: '24px',
          padding: '18px',
          backgroundColor: '#d4edda',
          borderRadius: '10px',
          border: '1px solid #c3e6cb'
        }
      }, [
        React.createElement('h4', { style: { margin: '0 0 8px 0', fontSize: '14px', color: '#155724' } }, '📊 统计'),
        React.createElement('div', { style: { fontSize: '13px', color: '#155724' } }, '阅读时长：约5分钟'),
      ])
    ]);

    return React.createElement('div', { style: { 
      width: '100%', 
      height: '100vh', 
      display: 'flex', 
      flexDirection: 'column',
      overflow: 'hidden'
    }}, [
      React.createElement('div', {
        key: 'main',
        style: {
          flex: 1,
          display: 'flex',
          overflow: 'hidden',
          backgroundColor: '#f5f7fa'
        }
      },
        React.createElement(window.ResponsiveSplitLayout, {
          leftContent: leftContent,
          rightContent: rightContent,
          threshold: 768,
          gap: 0,
          horizontalRatio: [2, 1],
        })
      ),
      React.createElement(window.FloatingCapsule, {
        key: 'bottom-capsule',
        items: pages,
        activeId: capsuleValue,
        onChange: (id) => {
          setCapsuleValue(id);
          setCurrentPage(id);
        },
        position: 'bottom',
        threshold: 600,
      })
    ]);
  };

  if (currentPage === 'layout') {
    return renderLayoutPage();
  }

  return React.createElement('div', { className: 'app-container' }, [
    React.createElement('header', { key: 'header', className: 'app-header' }, [
      React.createElement('h1', { key: 'title' }, (pages.find(p => p.id === currentPage) || {}).label || '组件演示'),
    ]),
    React.createElement('main', { key: 'main', className: 'app-main', style: { paddingBottom: 0 } }, [
      currentPage === 'rowlist' && renderRowListPage(),
      currentPage === 'menubutton' && renderMenuButtonPage(),
    ]),
    React.createElement(window.FloatingCapsule, {
      key: 'bottom-capsule',
      items: pages,
      activeId: capsuleValue,
      onChange: (id) => {
        setCapsuleValue(id);
        setCurrentPage(id);
      },
      position: 'bottom',
      threshold: 600,
    })
  ]);
};

window.App = App;
