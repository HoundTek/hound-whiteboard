class MockChunkLoader {
  constructor(limit = 0) {
    this.chunksLoadedLimit = limit;
    this.chunksLoaded = [];
    this.chunkNow = undefined;
  }

  moveCurrentRight() {
    if (!this.chunkNow || !this.chunkNow.rightChunk) return;
    this.chunkNow = this.chunkNow.rightChunk;
    return true;
  }

  forceMoveCurrentRightTempLoad() {
    return this.moveCurrentRight();
  }

  forceMoveCurrentRightFullLoad() {
    return this.moveCurrentRight();
  }

  moveCurrentLeft() {
    if (!this.chunkNow || !this.chunkNow.leftChunk) return;
    this.chunkNow = this.chunkNow.leftChunk;
    return true;
  }

  moveCurrentUp() {
    if (!this.chunkNow || !this.chunkNow.upChunk) return;
    this.chunkNow = this.chunkNow.upChunk;
    return true;
  }

  moveCurrentDown() {
    if (!this.chunkNow || !this.chunkNow.downChunk) return;
    this.chunkNow = this.chunkNow.downChunk;
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

  initChunk(chunk) {
    this.chunkNow = chunk;
    this.chunksLoaded = chunk ? [chunk] : [];
  }

  resetBuffer() {
    this.chunksLoaded = [];
    this.chunkNow = undefined;
  }
}

export { MockChunkLoader };
