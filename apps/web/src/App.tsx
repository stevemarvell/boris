import {
  IonApp,
  IonButton,
  IonContent,
  IonHeader,
  IonItemDivider,
  IonItemGroup,
  IonLabel,
  IonList,
  IonSearchbar,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
  setupIonicReact,
} from '@ionic/react';
import { useEffect, useMemo, useState } from 'react';
import { PersonCard } from './PersonCard';
import { ApiError, fetchGenerations } from './api';
import type { Generation } from './api';
import { countPeople, filterGenerations } from './filter';

setupIonicReact();

type State =
  | { status: 'loading' }
  | { status: 'ready'; generations: Generation[] }
  | { status: 'failed'; reason: string; retryAfterMs: number | null };

/**
 * The first load gets one automatic retry; after that the user is in charge.
 *
 * A click is the wrong thing to ask for here. The realistic cause of the first
 * failure is a cold start that *this very request* triggered: Railway wakes the
 * container when the request arrives, the request dies at the gate, and the
 * container is up moments later. Making someone press a button to collect a
 * server their own page load already started is a worse first visit than simply
 * asking again. Beyond the second attempt the evidence has changed — the API is
 * not merely asleep — so a third automatic attempt would just be hammering, and
 * the user gets a button instead.
 */
const AUTOMATIC_ATTEMPTS = 2;

/** The failures where trying again is plausibly the whole fix. */
function worthRetrying(err: unknown): boolean {
  return err instanceof ApiError && (err.failure === 'timeout' || err.failure === 'offline');
}

export function App() {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(1);
  const [query, setQuery] = useState('');
  // Set when the server sent a Retry-After, so the retry button cannot be used
  // to hammer an endpoint that has just said it is over its limit.
  const [holdOff, setHoldOff] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    fetchGenerations()
      .then((generations) => {
        if (!cancelled) setState({ status: 'ready', generations });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (attempt < AUTOMATIC_ATTEMPTS && worthRetrying(err)) {
          setAttempt(attempt + 1);
          return;
        }
        setState({
          status: 'failed',
          reason: err instanceof Error ? err.message : String(err),
          retryAfterMs: err instanceof ApiError ? err.retryAfterMs : null,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  useEffect(() => {
    const wait = state.status === 'failed' ? state.retryAfterMs : null;
    if (wait === null || wait <= 0) {
      setHoldOff(false);
      return;
    }
    setHoldOff(true);
    const timer = setTimeout(() => setHoldOff(false), wait);
    return () => clearTimeout(timer);
  }, [state]);

  const shown = useMemo(
    () => (state.status === 'ready' ? filterGenerations(state.generations, query) : []),
    [state, query],
  );
  const total = state.status === 'ready' ? countPeople(state.generations) : 0;

  return (
    <IonApp>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Family Tree</IonTitle>
        </IonToolbar>
        {state.status === 'ready' && (
          <IonToolbar>
            <IonSearchbar
              value={query}
              debounce={150}
              placeholder="Filter by name"
              data-testid="filter"
              onIonInput={(event) => setQuery(event.detail.value ?? '')}
            />
          </IonToolbar>
        )}
      </IonHeader>
      <IonContent>
        {state.status === 'loading' && (
          <div className="centred" data-testid="loading">
            <IonSpinner name="dots" />
            {/* The first attempt timing out is not nothing happening — say so,
                rather than leaving an unchanged spinner for another half a
                minute. */}
            {attempt > 1 && (
              <IonText color="medium">
                <p className="hint" data-testid="waking">
                  Still waiting — the server may be waking up.
                </p>
              </IonText>
            )}
          </div>
        )}

        {state.status === 'failed' && (
          <div className="centred" data-testid="error">
            <IonText color="danger">
              <p>Could not load the family tree — {state.reason}</p>
            </IonText>
            <IonButton
              size="small"
              fill="outline"
              data-testid="retry"
              disabled={holdOff}
              // Checked here as well as on the element. `disabled` on a custom
              // element is styling until the component upgrades; the rule that
              // a rate-limited caller does not get to send another request has
              // to hold whatever the DOM is doing.
              onClick={() => {
                if (!holdOff) setAttempt(attempt + 1);
              }}
            >
              {holdOff ? 'Try again shortly' : 'Try again'}
            </IonButton>
          </div>
        )}

        {/* An empty tree and a filter that matched nobody both leave the list
            empty, but they are different facts and need different words. */}
        {state.status === 'ready' && total === 0 && (
          <div className="centred" data-testid="empty-tree">
            <IonText color="medium">
              <p>No people recorded yet.</p>
            </IonText>
          </div>
        )}

        {state.status === 'ready' && total > 0 && shown.length === 0 && (
          <div className="centred" data-testid="no-matches">
            <IonText color="medium">
              <p>Nobody matches “{query}”.</p>
            </IonText>
          </div>
        )}

        {state.status === 'ready' && query.trim() !== '' && shown.length > 0 && (
          <IonText color="medium">
            <p className="match-count" data-testid="match-count">
              {countPeople(shown)} of {total} people
            </p>
          </IonText>
        )}

        {state.status === 'ready' && shown.length > 0 && (
          <IonList>
            {shown.map((generation) => (
              <IonItemGroup key={generation.depth} data-testid="generation">
                <IonItemDivider sticky>
                  <IonLabel>
                    Generation {generation.depth + 1}
                    <span className="count"> · {generation.people.length} people</span>
                  </IonLabel>
                </IonItemDivider>
                {generation.people.map((person) => (
                  <PersonCard key={person.id} person={person} />
                ))}
              </IonItemGroup>
            ))}
          </IonList>
        )}
      </IonContent>
    </IonApp>
  );
}
