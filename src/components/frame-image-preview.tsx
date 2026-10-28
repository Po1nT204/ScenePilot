'use client';
import { useEffect, useRef } from 'react';
import { imageFileProblem } from '@/lib/production/frame-transfer';

export function FrameImagePreview({ file }: { file: File }) {
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const element = ref.current; if (!element || imageFileProblem(file)) return;
    const url = URL.createObjectURL(file); element.src = url;
    return () => { element.removeAttribute('src'); URL.revokeObjectURL(url); };
  }, [file]);
  // Local files stay in the browser until the user confirms the upload.
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={ref} width={160} height={90} className="frame-file-preview" alt={`Предпросмотр ${file.name}`} />;
}
