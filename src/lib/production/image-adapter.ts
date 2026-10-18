import type { ImageProviderId } from './image-catalog';

export type ImageTask = { requestId: string; pollingUrl?: string };
export type ImageResult = { pending: false; bytes: Buffer; extension: 'jpg' | 'png' };
export type ImageSubmission = ImageResult | { pending: true; task: ImageTask };
export type ImageAccess = { provider: ImageProviderId; checkedAt: string; message: string; credits?: number };
export interface ImageAdapter {
  configured: boolean;
  checkConnection(): Promise<ImageAccess>;
  submit(prompt: string): Promise<ImageSubmission>;
  poll(task: ImageTask): Promise<ImageResult | { pending: true }>;
}
