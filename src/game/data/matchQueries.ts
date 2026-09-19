import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { GameConfig } from "../config/gameConfig";
import type { MatchRecord } from "../model/matchTypes";
import { fetchHistory, fetchRanking, getPendingMatches, getPlayerId, rememberPending, submitMatch } from "./matchApi";

export const rankingQueryKey = (config: GameConfig) => ["ranking", JSON.stringify(config)] as const;
export const historyQueryKey = (playerId: string) => ["match-history", playerId] as const;

export function useRanking(config: GameConfig, enabled: boolean) {
  return useQuery({
    queryKey: rankingQueryKey(config),
    queryFn: () => fetchRanking(config),
    enabled,
    staleTime: 10_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    retry: 2,
  });
}

export function useMatchHistory(enabled: boolean) {
  const playerId = getPlayerId();
  return useQuery({
    queryKey: historyQueryKey(playerId),
    queryFn: () => fetchHistory(playerId),
    enabled,
    staleTime: 10_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    retry: 2,
  });
}

export function useSubmitMatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (record: MatchRecord) => {
      try {
        return await submitMatch(record);
      } catch (error) {
        rememberPending(record, error);
        throw error;
      }
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["ranking"] });
      void queryClient.invalidateQueries({ queryKey: ["match-history"] });
      return result;
    },
  });
}

export function pendingMatches() {
  return getPendingMatches();
}