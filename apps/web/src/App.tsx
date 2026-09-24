import {
  IonApp,
  IonContent,
  IonHeader,
  IonText,
  IonTitle,
  IonToolbar,
  setupIonicReact,
} from '@ionic/react';

setupIonicReact();

/**
 * The web app's shell. The family tree it showed was stripped in #195; the
 * last commit that had it is tagged `family-tree-final`. The deployment still
 * serves the project's documentation at /docs/.
 */
export function App() {
  return (
    <IonApp>
      <IonHeader>
        <IonToolbar>
          <IonTitle>boris</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        <div className="centred" data-testid="shell">
          <IonText color="medium">
            <p>No application here yet.</p>
          </IonText>
          <a href="/docs/">The project documentation</a>
        </div>
      </IonContent>
    </IonApp>
  );
}
