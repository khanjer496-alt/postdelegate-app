import {
  ValidationArguments,
  ValidatorConstraintInterface,
  ValidatorConstraint,
} from 'class-validator';

// the extensions a post can attach; the library also keeps AVIF and BMP,
// which the composer shows as library only
export const ATTACHABLE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'mp4'];

export const isAttachablePath = (text: string) =>
  ATTACHABLE_EXTENSIONS.some(
    (ext) => !!text?.split?.('?')?.[0].endsWith(`.${ext}`)
  );

@ValidatorConstraint({ name: 'checkValidExtension', async: false })
export class ValidUrlExtension implements ValidatorConstraintInterface {
  validate(text: string, args: ValidationArguments) {
    return isAttachablePath(text);
  }

  defaultMessage(args: ValidationArguments) {
    // here you can provide default error message if validation failed
    return (
      'File must have a valid extension: .png, .jpg, .jpeg, .gif, .webp, or .mp4'
    );
  }
}

// also used for media urls that don't come through a DTO, like pictures in a post body
export const isAllowedUploadPath = (text: string) => {
  if (!process.env.RESTRICT_UPLOAD_DOMAINS) {
    return true;
  }

  return (
    (text || 'invalid url').indexOf(process.env.RESTRICT_UPLOAD_DOMAINS) > -1
  );
};

@ValidatorConstraint({ name: 'checkValidPath', async: false })
export class ValidUrlPath implements ValidatorConstraintInterface {
  validate(text: string, args: ValidationArguments) {
    return isAllowedUploadPath(text);
  }

  defaultMessage(args: ValidationArguments) {
    // here you can provide default error message if validation failed
    return (
      'URL must contain the domain: ' + process.env.RESTRICT_UPLOAD_DOMAINS + ' Make sure you first use the upload API route.'
    );
  }
}
