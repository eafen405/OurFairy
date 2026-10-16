import java.nio.file.*;
import kotlinx.serialization.json.*;
import me.rerere.rikkahub.data.remote.*;

/** Parse the real profile output using the exact compiled production Kotlin serializers. */
public final class ActualJobSample {
  public static void main(String[] args) throws Exception {
    JsonObject sample = (JsonObject) Json.Default.parseToJsonElement(Files.readString(Path.of(args[0])));
    RemoteTask task = Json.Default.decodeFromString(RemoteTask.Companion.serializer(), sample.get("task").toString());
    RemoteJobOutput output = Json.Default.decodeFromString(RemoteJobOutput.Companion.serializer(), sample.get("output").toString());
    if (task.getStatus() != 3 || task.getAvailability() != 0 || task.getReport().getStatus() != 3 || task.getReport().getTurn() != 2) throw new AssertionError("lost native lifecycle/report facts");
    if (!task.getTaskId().equals(output.getTaskId()) || output.getAvailability() != 0 || output.getStatus() != 3 || !output.getChunks().isEmpty() || !output.getLossy() || output.getTotal() != 106L) throw new AssertionError("lost unavailable-output facts");
    System.out.println("PASS actual backend sample: production RemoteTask+RemoteJobOutput serializers; stable id, completed status, unavailable output, report turn 2, total 106, lossy true");
  }
}
