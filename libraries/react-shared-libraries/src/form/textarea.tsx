'use client';

import {
  DetailedHTMLProps,
  FC,
  InputHTMLAttributes,
  useId,
  useMemo,
} from 'react';
import clsx from 'clsx';
import { useFormContext } from 'react-hook-form';
import { TranslatedLabel } from '../translation/translated-label';

export const Textarea: FC<
  DetailedHTMLProps<
    InputHTMLAttributes<HTMLTextAreaElement>,
    HTMLTextAreaElement
  > & {
    error?: any;
    disableForm?: boolean;
    label: string;
    name: string;
    translationKey?: string;
    translationParams?: Record<string, string | number>;
  }
> = (props) => {
  const {
    label,
    className,
    disableForm,
    error,
    translationKey,
    translationParams,
    ...rest
  } = props;
  const form = useFormContext();
  const generatedId = useId();
  const inputId = rest.id || generatedId;
  const errorId = `${inputId}-error`;
  const err = useMemo(() => {
    if (error) return error;
    if (!form || !form.formState.errors[props?.name!]) return;
    return form?.formState?.errors?.[props?.name!]?.message! as string;
  }, [form?.formState?.errors?.[props?.name!]?.message, error]);
  return (
    <div
      className={clsx(
        'flex flex-col gap-[6px]',
        props.disabled && 'opacity-50'
      )}
    >
      <label htmlFor={inputId} className="text-[14px]">
        <TranslatedLabel
          label={label}
          translationKey={translationKey}
          translationParams={translationParams}
        />
      </label>
      <textarea
        {...(disableForm ? {} : form.register(props.name))}
        className={clsx(
          'bg-input min-h-[150px] p-[16px] outline-none border-fifth border rounded-[4px] text-inputText placeholder-inputText',
          className
        )}
        aria-invalid={err ? true : undefined}
        aria-describedby={err ? errorId : undefined}
        {...rest}
        id={inputId}
      />
      <div id={errorId} className="text-red-400 text-[12px]">
        {err || <>&nbsp;</>}
      </div>
    </div>
  );
};
