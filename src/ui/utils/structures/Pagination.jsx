import React, { useMemo } from 'react';

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
  const currentItems = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    const end = start + itemsPerPage;
    return items.slice(start, end);
  }, [items, currentPage, itemsPerPage]);

  const handlePageChange = (page) => {
    if (page >= 1 && page <= totalPages && page !== currentPage) {
      onPageChange(page);
    }
  };

  const renderPageNumbers = () => {
    const pages = [];
    for (let i = 1; i <= totalPages; i++) {
      pages.push(
        <button
          key={i}
          className={`pagination-number ${i === currentPage ? 'active' : ''}`}
          onClick={() => handlePageChange(i)}
        >
          {i}
        </button>
      );
    }
    return pages;
  };

  return (
    <div className={`pagination-container ${className}`}>
      <div className="pagination-items">
        {currentItems.map((item, index) => (
          <div key={index} className="pagination-item">
            {renderItem(item, index)}
          </div>
        ))}
      </div>

      {totalPages > 1 && (
        <div className="pagination-controls">
          <button
            className="pagination-button pagination-first"
            onClick={() => handlePageChange(1)}
            disabled={currentPage === 1}
          >
            首页
          </button>

          <button
            className="pagination-button pagination-prev"
            onClick={() => handlePageChange(currentPage - 1)}
            disabled={currentPage === 1}
          >
            上一页
          </button>

          {showPageNumbers && (
            <div className="pagination-numbers">
              {renderPageNumbers()}
            </div>
          )}

          <button
            className="pagination-button pagination-next"
            onClick={() => handlePageChange(currentPage + 1)}
            disabled={currentPage === totalPages}
          >
            下一页
          </button>

          <button
            className="pagination-button pagination-last"
            onClick={() => handlePageChange(totalPages)}
            disabled={currentPage === totalPages}
          >
            末页
          </button>

          <span className="pagination-info">
            {currentPage} / {totalPages}
          </span>
        </div>
      )}
    </div>
  );
};

export default Pagination;
