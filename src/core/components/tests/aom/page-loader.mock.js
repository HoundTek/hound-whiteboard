class MockPageLoader {
  constructor(limit = 0) {
    this.pagesLoadedLimit = limit;
    this.pagesLoaded = [];
    this.pageNow = undefined;
  }

  moveCurrentRight() {
    if (!this.pageNow || !this.pageNow.rightPage) return;
    this.pageNow = this.pageNow.rightPage;
    return true;
  }

  forceMoveCurrentRightTempLoad() {
    return this.moveCurrentRight();
  }

  forceMoveCurrentRightFullLoad() {
    return this.moveCurrentRight();
  }

  moveCurrentLeft() {
    if (!this.pageNow || !this.pageNow.leftPage) return;
    this.pageNow = this.pageNow.leftPage;
    return true;
  }

  moveCurrentUp() {
    if (!this.pageNow || !this.pageNow.upPage) return;
    this.pageNow = this.pageNow.upPage;
    return true;
  }

  moveCurrentDown() {
    if (!this.pageNow || !this.pageNow.downPage) return;
    this.pageNow = this.pageNow.downPage;
    return true;
  }

  forceMoveCurrentLeftTempLoad() {
    return this.moveCurrentLeft();
  }

  forceMoveCurrentLeftFullLoad() {
    return this.moveCurrentLeft();
  }

  forceMoveCurrentUpTempLoad() {
    return this.moveCurrentUp();
  }

  forceMoveCurrentUpFullLoad() {
    return this.moveCurrentUp();
  }

  forceMoveCurrentDownTempLoad() {
    return this.moveCurrentDown();
  }

  forceMoveCurrentDownFullLoad() {
    return this.moveCurrentDown();
  }

  expandBufferRightTempLoad() {
    return this.moveCurrentRight();
  }

  expandBufferRightFullLoad() {
    return this.moveCurrentRight();
  }

  expandBufferLeftTempLoad() {
    return this.moveCurrentLeft();
  }

  expandBufferLeftFullLoad() {
    return this.moveCurrentLeft();
  }

  expandBufferUpTempLoad() {
    return this.moveCurrentUp();
  }

  expandBufferUpFullLoad() {
    return this.moveCurrentUp();
  }

  expandBufferDownTempLoad() {
    return this.moveCurrentDown();
  }

  expandBufferDownFullLoad() {
    return this.moveCurrentDown();
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

export { MockPageLoader };
