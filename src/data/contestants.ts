import { enrichStaticContestants } from '../lib/contestantEnrichment'
import { staticContestants } from './staticContestants'

export const contestants = enrichStaticContestants(staticContestants)
