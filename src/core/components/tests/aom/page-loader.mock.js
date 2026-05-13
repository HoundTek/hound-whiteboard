class MockPageLoader {
  constructor(limit = 0) {
    this.pagesLoadedLimit = limit;
    this.pagesLoaded = [];
    this.pageNow = undefined;
  }

  moveCurrentRight() {
    if (!this.pageNow || !this.pageNow.rightPage) return;
    this.pageNow = this.pageNow.rightPage;
  }

  forceMoveCurrentRightTempLoad() {
    this.moveCurrentRight();
  }

  forceMoveCurrentRightFullLoad() {
    this.moveCurrentRight();
  }

  moveCurrentLeft() {
    if (!this.pageNow || !this.pageNow.leftPage) return;
    this.pageNow = this.pageNow.leftPage;
  }

  moveCurrentUp() {}

  moveCurrentDown() {}

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

  expandBufferUpTempLoad() {
    this.moveCurrentUp();
  }

  expandBufferUpFullLoad() {
    this.moveCurrentUp();
  }

  expandBufferDownTempLoad() {
    this.moveCurrentDown();
  }

  expandBufferDownFullLoad() {
    this.moveCurrentDown();
  }

  shrinkBufferRight() {
    return false;
  }

  shrinkBufferLeft() {
    return false;
  }

  shrinkBufferUp() {
    return false;
  }

  shrinkBufferDown() {
    return false;
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