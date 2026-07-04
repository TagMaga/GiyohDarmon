import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { KEYS } from '../../../shared/queryKeys'
import { fetchMe, patchMe, uploadMyAvatar, fetchMyCompensation, fetchMyTeamRank, fetchMyTeam } from '../api'

export function useSellerMe() {
  return useQuery({
    queryKey: KEYS.seller.me,
    queryFn:  fetchMe,
    staleTime: 5 * 60 * 1000,
  })
}

export function usePatchMe() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: patchMe,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.seller.me }),
  })
}

export function useUploadMyAvatar() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: uploadMyAvatar,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.seller.me }),
  })
}

export function useSellerCompensation() {
  return useQuery({
    queryKey: KEYS.seller.compensation,
    queryFn:  fetchMyCompensation,
    staleTime: 10 * 60 * 1000,
  })
}

export function useSellerTeamRank() {
  return useQuery({
    queryKey: KEYS.seller.teamRank,
    queryFn:  fetchMyTeamRank,
    staleTime: 5 * 60 * 1000,
  })
}

export function useMyTeam() {
  return useQuery({
    queryKey: KEYS.seller.myTeam,
    queryFn:  fetchMyTeam,
    staleTime: 5 * 60 * 1000,
    retry: (failureCount, err) => err?.response?.status !== 404 && failureCount < 2,
  })
}
