import { useState, useEffect, useCallback, useRef } from 'react';
import { AxiosError } from 'axios';

interface UseApiOptions {
  immediate?: boolean;
  onSuccess?: (data: any) => void;
  onError?: (error: Error) => void;
}

interface UseApiReturn<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  execute: (...args: any[]) => Promise<T | null>;
  reset: () => void;
}

export function useApi<T = any>(
  apiCall: (...args: any[]) => Promise<any>,
  options: UseApiOptions = {}
): UseApiReturn<T> {
  const { immediate = false, onSuccess, onError } = options;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Use refs to avoid re-creating execute on every render when callers pass
  // inline functions for apiCall/onSuccess/onError.
  const apiCallRef = useRef(apiCall);
  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);
  apiCallRef.current = apiCall;
  onSuccessRef.current = onSuccess;
  onErrorRef.current = onError;

  const execute = useCallback(async (...args: any[]) => {
    setLoading(true);
    setError(null);

    try {
      const response = await apiCallRef.current(...args);
      const result = response?.data || response;
      setData(result);
      onSuccessRef.current?.(result);
      return result;
    } catch (err) {
      const error = err as AxiosError;
      const errorMessage = (error.response?.data as any)?.error || error.message || 'Request failed';
      const errorObj = new Error(errorMessage);
      setError(errorObj);
      onErrorRef.current?.(errorObj);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (immediate) {
      execute();
    }
  }, [immediate, execute]);

  const reset = useCallback(() => {
    setData(null);
    setLoading(false);
    setError(null);
  }, []);

  return { data, loading, error, execute, reset };
}

// Hook for paginated data
interface UsePaginationOptions extends UseApiOptions {
  pageSize?: number;
}

interface UsePaginationReturn<T> {
  data: T[];
  loading: boolean;
  error: Error | null;
  page: number;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
  reset: () => void;
}

export function usePagination<T = any>(
  apiCall: (page: number, pageSize: number) => Promise<any>,
  options: UsePaginationOptions = {}
): UsePaginationReturn<T> {
  const { immediate = false, pageSize = 20, onSuccess, onError } = options;
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  const apiCallRef = useRef(apiCall);
  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);
  apiCallRef.current = apiCall;
  onSuccessRef.current = onSuccess;
  onErrorRef.current = onError;

  const fetchData = useCallback(async (pageNum: number, append = false) => {
    setLoading(true);
    setError(null);

    try {
      const response = await apiCallRef.current(pageNum, pageSize);
      const result = response?.data || response;
      const items = Array.isArray(result) ? result : result.items || result.data || [];

      if (append) {
        setData(prev => [...prev, ...items]);
      } else {
        setData(items);
      }

      setHasMore(items.length === pageSize);
      onSuccessRef.current?.(items);
    } catch (err) {
      const error = err as AxiosError;
      const errorMessage = (error.response?.data as any)?.error || error.message || 'Request failed';
      setError(new Error(errorMessage));
      onErrorRef.current?.(new Error(errorMessage));
    } finally {
      setLoading(false);
    }
  }, [pageSize]);

  const loadMore = useCallback(async () => {
    if (!loading && hasMore) {
      const nextPage = page + 1;
      setPage(nextPage);
      await fetchData(nextPage, true);
    }
  }, [page, loading, hasMore, fetchData]);

  const refresh = useCallback(async () => {
    setPage(1);
    await fetchData(1, false);
  }, [fetchData]);

  const reset = useCallback(() => {
    setData([]);
    setLoading(false);
    setError(null);
    setPage(1);
    setHasMore(true);
  }, []);

  useEffect(() => {
    if (immediate) {
      fetchData(1, false);
    }
  }, [immediate, fetchData]);

  return { data, loading, error, page, hasMore, loadMore, refresh, reset };
}

// Hook for form submission
interface UseFormOptions {
  onSuccess?: (data: any) => void;
  onError?: (error: Error) => void;
  resetOnSuccess?: boolean;
}

interface UseFormReturn<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  submit: (formData: any) => Promise<T | null>;
  reset: () => void;
}

export function useForm<T = any>(
  apiCall: (formData: any) => Promise<any>,
  options: UseFormOptions = {}
): UseFormReturn<T> {
  const { onSuccess, onError, resetOnSuccess = true } = options;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const apiCallRef = useRef(apiCall);
  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);
  apiCallRef.current = apiCall;
  onSuccessRef.current = onSuccess;
  onErrorRef.current = onError;

  const submit = useCallback(async (formData: any) => {
    setLoading(true);
    setError(null);

    try {
      const response = await apiCallRef.current(formData);
      const result = response?.data || response;
      setData(result);
      onSuccessRef.current?.(result);

      if (resetOnSuccess) {
        setData(null);
      }

      return result;
    } catch (err) {
      const error = err as AxiosError;
      const errorMessage = (error.response?.data as any)?.error || error.message || 'Request failed';
      const errorObj = new Error(errorMessage);
      setError(errorObj);
      onErrorRef.current?.(errorObj);
      return null;
    } finally {
      setLoading(false);
    }
  }, [resetOnSuccess]);

  const reset = useCallback(() => {
    setData(null);
    setLoading(false);
    setError(null);
  }, []);

  return { data, loading, error, submit, reset };
}

export default useApi;
