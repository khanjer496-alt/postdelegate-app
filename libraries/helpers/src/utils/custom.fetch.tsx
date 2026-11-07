'use client';

import {
  createContext,
  FC,
  ReactNode,
  useContext,
  useRef,
  useState,
} from 'react';
import { customFetch, Params } from './custom.fetch.func';
import { useVariables } from '@gitroom/react/helpers/variable.context';

const FetchProvider = createContext(
  customFetch(
    // @ts-ignore
    {
      baseUrl: '',
      beforeRequest: () => {},
      afterRequest: () => {
        return true;
      },
    } as Params
  )
);

export const FetchWrapperComponent: FC<Params & { children: ReactNode }> = (
  props
) => {
  const { children, ...params } = props;
  const { isSecured } = useVariables();
  // the fetch is made once, it reads the latest params on every request so
  // afterRequest never keeps a stale translation or variable
  const latestParams = useRef(params);
  latestParams.current = params;
  const fetchData = useRef(
    customFetch(
      {
        get baseUrl() {
          return latestParams.current.baseUrl;
        },
        beforeRequest: (url, options) =>
          latestParams.current.beforeRequest
            ? latestParams.current.beforeRequest(url, options)
            : Promise.resolve(options),
        afterRequest: async (url, options, response) =>
          latestParams.current.afterRequest
            ? latestParams.current.afterRequest(url, options, response)
            : true,
      },
      undefined,
      undefined,
      isSecured
    )
  );
  return (
    // @ts-ignore
    <FetchProvider.Provider value={fetchData.current}>
      {children}
    </FetchProvider.Provider>
  );
};

export const useFetch = () => {
  return useContext(FetchProvider);
};
