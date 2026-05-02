class MockPageLoader {
  constructor(limit = 0) {
    this.pagesLoadedLimit = limit;
    this.pagesLoaded = [];
    this.pageNow = undefined;
  }

  moveCurrentRight() {
    if (!this.pageNow || !this.pageNow.nextPage) return;
    this.pageNow = this.pageNow.nextPage;
  }

  forceMoveCurrentRightTempLoad() {
    this.moveCurrentRight();
  }

  forceMoveCurrentRightFullLoad() {
    this.moveCurrentRight();
  }

  moveCurrentLeft() {
    if (!this.pageNow || !this.pageNow.prevPage) return;
    this.pageNow = this.pageNow.prevPage;
  }

  forceMoveCurrentLeftTempLoad() {
    this.moveCurrentLeft();
  }

  forceMoveCurrentLeftFullLoad() {
    this.moveCurrentLeft();
  }

  expandBufferRightTempLoad() {
    this.moveCurrentRight();
  }

  expandBufferRightFullLoad() {
    this.moveCurrentRight();
  }

  expandBufferLeftTempLoad() {
    this.moveCurrentLeft();
  }

  expandBufferLeftFullLoad() {
    this.moveCurrentLeft();
  }

  resetCurrentPage(page) {
    this.pageNow = page;
    this.pagesLoaded = page ? [page] : [];
  }

  resetBuffer() {
    this.pagesLoaded = [];
    this.pageNow = undefined;
  }
}

export {
  MockPageLoader,
};