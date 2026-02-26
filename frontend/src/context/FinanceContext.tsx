import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { getCategories, getMerchantAliases, getRules, getTags } from "../api/client";
import type { Category, MerchantAlias, Rule, Tag } from "../types";

interface FinanceContextValue {
  // Shared reference data — fetched once, updated via targeted refresh
  categories: Category[];
  tags: Tag[];
  rules: Rule[];
  merchantAliases: MerchantAlias[];

  // True while the initial parallel fetch is in flight
  bootstrapping: boolean;

  // Cache-bust signal for time-sensitive pages (replaces refreshKey prop drilling)
  refreshKey: number;
  bump: () => void;

  // Targeted refresh — call after mutations to that specific resource
  refreshCategories: () => Promise<void>;
  refreshTags: () => Promise<void>;
  refreshRules: () => Promise<void>;
  refreshAliases: () => Promise<void>;
}

const FinanceContext = createContext<FinanceContextValue | null>(null);

export function FinanceProvider({ children }: { children: React.ReactNode }) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [merchantAliases, setMerchantAliases] = useState<MerchantAlias[]>([]);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  // Bootstrap: fetch all shared resources in parallel on mount
  useEffect(() => {
    Promise.all([getCategories(), getTags(), getRules(), getMerchantAliases()])
      .then(([cats, tgs, rls, aliases]) => {
        setCategories(cats);
        setTags(tgs);
        setRules(rls);
        setMerchantAliases(aliases);
      })
      .catch(() => {})
      .finally(() => setBootstrapping(false));
  }, []);

  const bump = useCallback(() => setRefreshKey((k) => k + 1), []);

  const refreshCategories = useCallback(async () => {
    const cats = await getCategories();
    setCategories(cats);
  }, []);

  const refreshTags = useCallback(async () => {
    const tgs = await getTags();
    setTags(tgs);
  }, []);

  const refreshRules = useCallback(async () => {
    const rls = await getRules();
    setRules(rls);
  }, []);

  const refreshAliases = useCallback(async () => {
    const aliases = await getMerchantAliases();
    setMerchantAliases(aliases);
  }, []);

  return (
    <FinanceContext.Provider
      value={{
        categories,
        tags,
        rules,
        merchantAliases,
        bootstrapping,
        refreshKey,
        bump,
        refreshCategories,
        refreshTags,
        refreshRules,
        refreshAliases,
      }}
    >
      {children}
    </FinanceContext.Provider>
  );
}

export function useFinance(): FinanceContextValue {
  const ctx = useContext(FinanceContext);
  if (!ctx) throw new Error("useFinance must be used inside <FinanceProvider>");
  return ctx;
}
