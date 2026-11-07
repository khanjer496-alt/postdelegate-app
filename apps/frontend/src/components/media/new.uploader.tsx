import React, {
  FC,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
// @ts-ignore
import Uppy, { BasePlugin, UploadResult, UppyFile } from '@uppy/core';
// @ts-ignore
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { HandledResponseError } from '@gitroom/helpers/utils/custom.fetch.func';
import {
  getUppyUploadPlugin,
  WaitForMediaProcessing,
} from '@gitroom/react/helpers/uppy.upload';
import { Dashboard, FileInput, ProgressBar } from '@uppy/react';

// Uppy styles
import { useVariables } from '@gitroom/react/helpers/variable.context';
import Compressor from '@uppy/compressor';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useLaunchStore } from '@gitroom/frontend/components/new-launch/store';
import { uniqBy } from 'lodash';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';

// The server keeps pictures up to 10 MB (getMaxSize). The types compressed
// here before the upload shrink well under it, so they may start larger.
const MAX_IMAGE_SIZE_MB = 10;
const MAX_IMAGE_SIZE_BEFORE_COMPRESSION_MB = 30;
const COMPRESSED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export class CompressionWrapper<M = any, B = any> extends Compressor<any, any> {
  override async prepareUpload(fileIDs: string[]) {
    const { files } = this.uppy.getState();

    // 1) Skip GIFs (and anything missing)
    const filteredIDs = fileIDs.filter((id) => {
      const f = files[id];
      if (!f) return false;

      const type = f.type ?? '';
      const name = (f.name ?? '').toLowerCase();
      const isGif = type === 'image/gif' || name.endsWith('.gif');

      return !isGif;
    });

    // 2) Let @uppy/compressor do its work (convert/resize/etc)
    return super.prepareUpload(filteredIDs);
  }
}

// Every byte is sent but the upload is not done yet: the storage still
// assembles the file and the server saves it, which can take a few seconds.
// The status bar would sit at 100% meanwhile, so this says it is processing
export const UploadProcessing: FC<{ uppy: any }> = ({ uppy }) => {
  const t = useT();
  const [processing, setProcessing] = useState(false);
  useEffect(() => {
    const progress = (value: number) => setProcessing(value >= 100);
    const done = () => setProcessing(false);
    uppy.on('progress', progress);
    uppy.on('complete', done);
    uppy.on('error', done);
    uppy.on('cancel-all', done);
    return () => {
      uppy.off('progress', progress);
      uppy.off('complete', done);
      uppy.off('error', done);
      uppy.off('cancel-all', done);
    };
  }, [uppy]);

  if (!processing) {
    return null;
  }

  return (
    <div
      role="status"
      className="absolute inset-0 z-[1] flex items-center gap-[8px] px-[16px] bg-newBgColorInner text-[14px] text-textColor"
    >
      <span
        aria-hidden="true"
        className="w-[14px] h-[14px] rounded-full border-2 border-newTableBorder border-t-btnCta animate-spin"
      />
      {t('processing', 'Processing...')}
    </div>
  );
};

export function useUppyUploader(props: {
  // @ts-ignore
  onUploadSuccess: (result: UploadResult) => void;
  onStart: () => void;
  onEnd: () => void;
  allowedFileTypes: string;
}) {
  const setLocked = useLaunchStore((state) => state.setLocked);
  const toast = useToaster();
  const t = useT();
  const {
    storageProvider,
    backendUrl,
    disableImageCompression,
    transloadit,
    mediaProcessing,
  } = useVariables();
  const { onUploadSuccess, allowedFileTypes } = props;
  const fetch = useFetch();
  return useMemo(() => {
    // Track file order to maintain original sequence after upload
    let fileOrderIndex = 0;

    const uppy2 = new Uppy({
      autoProceed: true,
      restrictions: {
        // maxNumberOfFiles: 5,
        // allowedFileTypes: allowedFileTypes.split(','),
        maxFileSize: 1000000000, // Default 1GB, but we'll override with custom validation
      },
    });

    // this uploader holds its own lock of the composer, released once none of
    // its uploads still runs or still saves its files
    const lockOwner = makeId(10);
    let saving = 0;
    const unlock = () => {
      if (!saving && !Object.keys(uppy2.getState().currentUploads).length) {
        setLocked(false, lockOwner);
      }
    };

    // check for valid file types it can be something like this image/*,video/mp4.
    // If it's an image, I need to replace image/* with image/png, image/jpeg, image/jpeg, image/gif (separately)
    uppy2.addPreProcessor((fileIDs) => {
      return new Promise<void>((resolve, reject) => {
        const files = uppy2.getFiles();
        const allowedTypes = allowedFileTypes
          .split(',')
          .map((type) => type.trim());

        // Expand generic types to specific ones
        const expandedTypes = allowedTypes.flatMap((type) => {
          if (type === 'image/*') {
            return [
              'image/png',
              'image/jpeg',
              'image/jpg',
              'image/gif',
              'image/webp',
            ];
          }
          if (type === 'video/*') {
            return ['video/mp4', 'video/mpeg', 'video/quicktime'];
          }
          // the normalizer turns QuickTime into mp4, nothing else is accepted by the bucket
          if (type === 'video/mp4' && mediaProcessing) {
            return ['video/mp4', 'video/quicktime'];
          }
          if (type === 'video/mp4' && transloadit && transloadit.length > 0) {
            return ['video/mp4', 'video/mpeg', 'video/quicktime'];
          }
          return [type];
        });

        for (const file of files) {
          if (fileIDs.includes(file.id)) {
            const fileType = file.type;

            // Check if file type is allowed
            const isAllowed = expandedTypes.some((allowedType) => {
              if (allowedType.endsWith('/*')) {
                const baseType = allowedType.replace('/*', '/');
                return fileType?.startsWith(baseType);
              }
              return fileType === allowedType;
            });

            if (!isAllowed) {
              const error = new Error(
                `File type "${fileType}" is not allowed for file "${file.name}". Allowed types: ${allowedFileTypes}`
              );
              uppy2.log(error.message, 'error');
              uppy2.info(error.message, 'error', 5000);
              toast.show(
                `File type "${fileType}" is not allowed. Allowed types: ${allowedFileTypes}`,
                'warning'
              );
              uppy2.removeFile(file.id);
              return reject(error);
            }
          }
        }

        resolve();
      });
    });

    uppy2.addPreProcessor((fileIDs) => {
      return new Promise<void>((resolve, reject) => {
        const files = uppy2.getFiles();

        for (const file of files) {
          if (fileIDs.includes(file.id)) {
            const isImage = file.type?.startsWith('image/');
            const isVideo = file.type?.startsWith('video/');

            const compressed =
              !disableImageCompression &&
              !mediaProcessing &&
              COMPRESSED_IMAGE_TYPES.includes(file.type || '');
            const maxImageSizeMB = compressed
              ? MAX_IMAGE_SIZE_BEFORE_COMPRESSION_MB
              : MAX_IMAGE_SIZE_MB;
            const maxImageSize = maxImageSizeMB * 1024 * 1024;
            const maxVideoSize = 1000 * 1024 * 1024; // 1GB

            if (isImage && file.size > maxImageSize) {
              const isGif =
                file.type === 'image/gif' ||
                (file.name || '').toLowerCase().endsWith('.gif');
              const message = isGif
                ? t(
                    'gif_too_large',
                    'GIFs are uploaded without compression, so a GIF can be at most {{size}} MB.',
                    { size: maxImageSizeMB }
                  )
                : t(
                    'image_too_large',
                    'Pictures can be at most {{size}} MB.',
                    { size: maxImageSizeMB }
                  );
              const error = new Error(`${file.name}: ${message}`);
              uppy2.log(error.message, 'error');
              uppy2.info(error.message, 'error', 5000);
              toast.show(message, 'warning');
              uppy2.removeFile(file.id); // Remove file from queue
              return reject(error);
            }

            if (isVideo && file.size > maxVideoSize) {
              const error = new Error(
                `Video file "${file.name}" is too large. Maximum size allowed is 1GB.`
              );
              uppy2.log(error.message, 'error');
              uppy2.info(error.message, 'error', 5000);
              toast.show(
                `Video file is too large. Maximum size allowed is 1GB.`
              );
              uppy2.removeFile(file.id); // Remove file from queue
              return reject(error);
            }
          }
        }

        resolve();
      });
    });

    // The normalizer takes precedence over Transloadit, so both can stay
    // configured and turning the normalizer off falls back to Transloadit
    const useTransloadit = !mediaProcessing && transloadit.length > 0;
    const { plugin, options } = getUppyUploadPlugin(
      useTransloadit ? 'transloadit' : storageProvider,
      fetch,
      backendUrl,
      transloadit
    );

    uppy2.use(plugin, options);
    // installed whenever the record can come back "processing", so the backend
    // decides; it passes files through untouched when the row is already ready
    if (storageProvider === 'cloudflare' && !useTransloadit) {
      uppy2.use(WaitForMediaProcessing, {
        fetch,
        processingMessage: t('processing', 'Processing...'),
        fallbackMessage: t(
          'could_not_optimize_file',
          'Could not optimize the file, the original will be used'
        ),
      });
    }
    // the normalizer resizes on the server, shrinking first would only make it upscale a blurry copy
    if (!disableImageCompression && !mediaProcessing) {
      uppy2.use(CompressionWrapper, {
        convertTypes: COMPRESSED_IMAGE_TYPES,
        maxWidth: 1000,
        maxHeight: 1000,
        quality: 1,
      });
    }
    // Set additional metadata when a file is added
    uppy2.on('file-added', (file) => {
      setLocked(true, lockOwner);
      uppy2.setFileMeta(file.id, {
        useCloudflare: storageProvider === 'cloudflare' ? 'true' : 'false', // Example of adding a custom field
        addedOrder: fileOrderIndex++, // Track original order for sorting after upload
        // Add more fields as needed
      });
    });
    uppy2.on('error', (result) => {
      // a single file failing leaves the batch running, 'complete' reports it with the rest
      if (Object.keys(uppy2.getState().currentUploads).length) {
        return;
      }
      uppy2.cancelAll();
      unlock();
      props.onEnd();
      fileOrderIndex = 0;
    });
    // a closed window cancels its uploads, nothing finishes them anymore; a
    // batch still saving its files releases the lock once it is done
    uppy2.on('cancel-all', () => {
      if (!saving) {
        setLocked(false, lockOwner);
      }
    });
    uppy2.on('upload-start', () => {
      props.onStart();
    });
    uppy2.on('complete', async (result) => {
      console.log(result);
      for (const file of [...result.successful, ...(result.failed || [])]) {
        uppy2.removeFile(file.id);
      }

      if (result.failed?.length) {
        toast.show(
          t(
            'some_files_failed_to_upload',
            'Some files failed to upload, please try again'
          ),
          'warning'
        );
      }

      props.onEnd();
      // Sort results by original add order to maintain file sequence
      const sortedSuccessful = [...result.successful].sort((a, b) => {
        const orderA = +((a.meta as any)?.addedOrder ?? 0);
        const orderB = +((b.meta as any)?.addedOrder ?? 0);
        return orderA - orderB;
      });

      try {
        if (storageProvider === 'local') {
          onUploadSuccess(sortedSuccessful.map((p) => p.response.body));
          return;
        }

        if (useTransloadit) {
          saving++;
          try {
            // @ts-ignore
            const allRes = result.transloadit[0].results;
            const toSave = uniqBy<{
              name: string;
              originalName: string;
              order: number;
            }>(
              // @ts-ignore
              Object.values(allRes).flatMap((p: any[]) => {
                return p.flatMap((item) => ({
                  name: item.url.split('/').pop(),
                  originalName: item.name || '',
                  order: +item.user_meta.addedOrder,
                }));
              }),
              (item) => item.name
            );

            const loadAllMedia = (
              await Promise.all(
                toSave.map(async ({ name, originalName, order }) => {
                  const saved = await fetch('/media/save-media', {
                    method: 'POST',
                    body: JSON.stringify({
                      name,
                      originalName,
                    }),
                  });
                  if (!saved.ok) {
                    throw new Error(`save-media answered ${saved.status}`);
                  }
                  return { file: await saved.json(), order };
                })
              )
            )
              .sort((a, b) => {
                return a.order - b.order;
              })
              .map((p) => p.file);

            onUploadSuccess(loadAllMedia);
          } finally {
            saving = Math.max(0, saving - 1);
          }
          return;
        }

        onUploadSuccess(sortedSuccessful.map((p) => p.response.body.saved));
      } catch (e) {
        // a dialog already told the user why it stopped
        if (!(e instanceof HandledResponseError)) {
          toast.show(
            t(
              'some_files_failed_to_upload',
              'Some files failed to upload, please try again'
            ),
            'warning'
          );
        }
      } finally {
        fileOrderIndex = 0;
        unlock();
      }
    });
    uppy2.on('upload-success', (file, response) => {
      const current = uppy2.getState().files[file.id];
      if (!current) {
        return;
      }
      // @ts-ignore
      uppy2.setFileState(file.id, {
        // @ts-ignore
        progress: current.progress,
        // @ts-ignore
        uploadURL: response.body.Location,
        response: response,
        isPaused: false,
      });
    });
    return uppy2;
  }, []);
}
