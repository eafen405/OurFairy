import java.nio.file.*;
import kotlinx.serialization.json.*;
import me.rerere.rikkahub.data.remote.*;

/** Decode the actual backend sample using the compiled Android production serializer. */
public final class ActualActivitySample {
  public static void main(String[] args) throws Exception {
    RemoteActivity activity = Json.Default.decodeFromString(RemoteActivity.Companion.serializer(), Files.readString(Path.of(args[0])));
    RemoteCompletedActivity completed = activity.getCompleted();
    if (activity.getStatus() != 1 || !activity.getReasons().isEmpty() || activity.getThroughSeq() != 29 || completed == null) throw new AssertionError("lost quiet/completed facts");
    if (!activity.getEpisodeId().equals(completed.getEpisodeId()) || activity.getStartedSeq() != 2L || completed.getStartedSeq() != 2L || completed.getFinishedSeq() != 29L || completed.getOutputSeq() != 27L) throw new AssertionError("lost persistent episode/seq facts");
    if (activity.getDelivery() != null) throw new AssertionError("invented delivery");
    System.out.println("PASS actual backend activity: production RemoteActivity serializer; status quiet, stable episode identity, startedSeq 2, throughSeq/finishedSeq 29, outputSeq 27, no invented delivery");
  }
}
