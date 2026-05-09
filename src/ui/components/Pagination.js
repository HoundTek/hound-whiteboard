const Pagination = ({
  items,
  itemsPerPage = 10,
  currentPage = 1,
  onPageChange,
  className = '',
  renderItem,
  showPageNumbers = true,
}) => {
  const totalPages = Math.ceil(items.length / itemsPerPage);
  const currentItems = items.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const handlePageChange = (page) => {
    if (page >= 1 && page <= totalPages && page !== currentPage) {
      onPageChange(page);
    }
  };

  const renderPageNumbers = () => {
    const pages = [];
    for (let i = 1; i <= totalPages; i++) {
      pages.push(
        React.createElement('button', {
          key: i,
          className: `pagination-number ${i === currentPage ? 'active' : ''}`,
          onClick: () => handlePageChange(i),
        }, i)
      );
    }
    return pages;
  };

  const controls = totalPages > 1
    ? React.createElement('div', { key: 'controls', className: 'pagination-controls' }, [
        React.createElement('button', {
          key: 'first',
          className: 'pagination-button pagination-first',
          onClick: () => handlePageChange(1),
          disabled: currentPage === 1,
        }, '首页'),
        React.createElement('button', {
          key: 'prev',
          className: 'pagination-button pagination-prev',
          onClick: () => handlePageChange(currentPage - 1),
          disabled: currentPage === 1,
        }, '上一页'),
        showPageNumbers && React.createElement('div', { key: 'numbers', className: 'pagination-numbers' }, renderPageNumbers()),
        React.createElement('button', {
          key: 'next',
          className: 'pagination-button pagination-next',
          onClick: () => handlePageChange(currentPage + 1),
          disabled: currentPage === totalPages,
        }, '下一页'),
        React.createElement('button', {
          key: 'last',
          className: 'pagination-button pagination-last',
          onClick: () => handlePageChange(totalPages),
          disabled: currentPage === totalPages,
        }, '末页'),
        React.createElement('span', { key: 'info', className: 'pagination-info' }, `${currentPage} / ${totalPages}`),
      ])
    : null;

  return React.createElement('div', { className: `pagination-container ${className}` }, [
    React.createElement('div', { key: 'items', className: 'pagination-items' },
      currentItems.map((item, index) =>
        React.createElement('div', { key: index, className: 'pagination-item' }, renderItem(item, index))
      )
    ),
    controls,
  ]);
};

window.Pagination = Pagination;