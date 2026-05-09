import React, { useState } from 'react';
import {
  DynamicRowList,
  DynamicColumnList,
  DynamicGrid,
  ResponsiveSplitLayout,
  Pagination,
} from '../utils/structures';
import {
  Text,
  Icon,
  IconWithText,
  DisplayBox,
  DisplayBoxWithText,
  MenuButton,
  FloatingCapsuleSwitcher,
} from '../utils/templates';

const App = () => {
  const [activeTab, setActiveTab] = useState('structures');
  const [currentPage, setCurrentPage] = useState(1);
  const [switcherValue, setSwitcherValue] = useState('option1');

  const gridItems = Array.from({ length: 12 }, (_, i) => ({
    id: i + 1,
    title: `项目 ${i + 1}`,
  }));

  const menuItems = [
    { label: '编辑', value: 'edit' },
    { label: '删除', value: 'delete' },
    { label: '分享', value: 'share' },
  ];

  const switcherOptions = [
    { label: '选项一', value: 'option1' },
    { label: '选项二', value: 'option2' },
    { label: '选项三', value: 'option3' },
  ];

  const tabs = [
    { label: '结构组件', value: 'structures' },
    { label: '模板组件', value: 'templates' },
  ];

  return (
    <div style={{
      minHeight: '100vh',
      padding: '20px',
      maxWidth: '1200px',
      margin: '0 auto',
    }}>
      <div style={{ marginBottom: '24px' }}>
        <Text size="xlarge" weight="bold" color="var(--primary-color)">
          Hound Whiteboard UI 组件库
        </Text>
      </div>

      <FloatingCapsuleSwitcher
        options={tabs}
        value={activeTab}
        onChange={setActiveTab}
        style={{ marginBottom: '32px' }}
      />

      {activeTab === 'structures' ? (
        <DynamicColumnList gap={32} items={[
          {
            title: '动态行列表 (DynamicRowList)',
            component: (
              <DynamicRowList
                gap={16}
                items={gridItems.slice(0, 6)}
                renderItem={(item) => (
                  <DisplayBox padding={16}>
                    <Text>{item.title}</Text>
                  </DisplayBox>
                )}
              />
            ),
          },
          {
            title: '动态列列表 (DynamicColumnList)',
            component: (
              <DynamicColumnList
                gap={12}
                items={gridItems.slice(0, 4)}
                renderItem={(item) => (
                  <DisplayBox padding={16}>
                    <Text>{item.title}</Text>
                  </DisplayBox>
                )}
              />
            ),
          },
          {
            title: '动态网格 (DynamicGrid)',
            component: (
              <DynamicGrid
                gap={20}
                cellMinWidth={150}
                items={gridItems}
                renderItem={(item) => (
                  <DisplayBox padding={20}>
                    <IconWithText
                      iconSrc="data/icons/default/add.svg"
                      iconAlt="add"
                      iconSize={32}
                      text={item.title}
                    />
                  </DisplayBox>
                )}
              />
            ),
          },
          {
            title: '响应式分割布局 (ResponsiveSplitLayout)',
            component: (
              <ResponsiveSplitLayout
                threshold={600}
                gap={24}
                leftContent={
                  <DisplayBox padding={20}>
                    <Text weight="semibold">左侧内容</Text>
                    <Text size="small" color="var(--text-secondary-color)">
                      在小屏幕上会垂直排列
                    </Text>
                  </DisplayBox>
                }
                rightContent={
                  <DisplayBox padding={20}>
                    <Text weight="semibold">右侧内容</Text>
                    <Text size="small" color="var(--text-secondary-color)">
                      在大屏幕上会水平排列
                    </Text>
                  </DisplayBox>
                }
              />
            ),
          },
          {
            title: '分页组件 (Pagination)',
            component: (
              <Pagination
                items={gridItems}
                itemsPerPage={4}
                currentPage={currentPage}
                onPageChange={setCurrentPage}
                renderItem={(item) => (
                  <DisplayBox padding={16} style={{ marginBottom: 8 }}>
                    <Text>{item.title}</Text>
                  </DisplayBox>
                )}
              />
            ),
          },
        ]} renderItem={(section) => (
          <div>
            <Text size="large" weight="semibold" style={{ marginBottom: 16 }}>
              {section.title}
            </Text>
            {section.component}
          </div>
        )} />
      ) : (
        <DynamicColumnList gap={32} items={[
          {
            title: '文本 (Text)',
            component: (
              <DisplayBox padding={20}>
                <DynamicColumnList gap={8} items={[
                  { size: 'small', text: '小文本' },
                  { size: 'medium', text: '中等文本' },
                  { size: 'large', text: '大文本' },
                  { size: 'xlarge', text: '超大文本' },
                ]} renderItem={(item) => (
                  <Text size={item.size}>{item.text}</Text>
                )} />
              </DisplayBox>
            ),
          },
          {
            title: '图标 + 文字 (IconWithText)',
            component: (
              <DynamicRowList gap={24} items={[
                { icon: 'add', text: '添加' },
                { icon: 'setting', text: '设置' },
                { icon: 'help', text: '帮助' },
              ]} renderItem={(item) => (
                <DisplayBox padding={20}>
                  <IconWithText
                    iconSrc={`data/icons/default/${item.icon}.svg`}
                    iconAlt={item.text}
                    iconSize={48}
                    text={item.text}
                  />
                </DisplayBox>
              )} />
            ),
          },
          {
            title: '展示框 + 文字 (DisplayBoxWithText)',
            component: (
              <DynamicRowList gap={24} items={[
                { text: '项目一', color: '#667eea' },
                { text: '项目二', color: '#764ba2' },
                { text: '项目三', color: '#48bb78' },
              ]} renderItem={(item) => (
                <DisplayBoxWithText
                  text={item.text}
                  boxBackgroundColor={item.color + '10'}
                  boxBorderColor={item.color}
                >
                  <div style={{
                    width: 80,
                    height: 80,
                    backgroundColor: item.color,
                    borderRadius: 8,
                  }} />
                </DisplayBoxWithText>
              )} />
            ),
          },
          {
            title: '带菜单按钮 (MenuButton)',
            component: (
              <DynamicRowList gap={24} items={[
                { text: '文件' },
                { text: '图片' },
              ]} renderItem={(item) => (
                <MenuButton
                  text={item.text}
                  menuItems={menuItems}
                  onMenuItemClick={(menuItem) => console.log('点击:', menuItem)}
                >
                  <IconWithText
                    iconSrc="data/icons/default/add.svg"
                    iconAlt={item.text}
                    iconSize={40}
                    text="点击"
                  />
                </MenuButton>
              )} />
            ),
          },
          {
            title: '浮动胶囊切换器 (FloatingCapsuleSwitcher)',
            component: (
              <DisplayBox padding={20}>
                <Text style={{ marginBottom: 16 }}>当前选中: {switcherValue}</Text>
                <FloatingCapsuleSwitcher
                  options={switcherOptions}
                  value={switcherValue}
                  onChange={setSwitcherValue}
                />
              </DisplayBox>
            ),
          },
        ]} renderItem={(section) => (
          <div>
            <Text size="large" weight="semibold" style={{ marginBottom: 16 }}>
              {section.title}
            </Text>
            {section.component}
          </div>
        )} />
      )}
    </div>
  );
};

export default App;
