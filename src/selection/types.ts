export interface SelectionRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
}

export interface SelectionInfo {
  /** The selected words, whitespace-normalized. */
  phrase: string;
  /** The surrounding block of text (paragraph/sentence). */
  context: string;
  /** Text between the start of the block and the selection. */
  before?: string;
  /** Text between the selection and the end of the block. */
  after?: string;
  /** Bounding box of the whole selection, in viewport coordinates. */
  rect: SelectionRect;
  /** One box per rendered line of the selection. */
  rects: SelectionRect[];
}
