import me.rerere.rikkahub.data.remote.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.serialization.json.*
class ProbeBackend : RemoteChatBackend {
    val facts = MutableStateFlow(projection("old-agent", "unsaved"))
    override fun observe(token: String, sessionId: String): Flow<RemoteChatProjection> = facts
    override suspend fun checkpoint(token: String, sessionId: String) = -1L
    override suspend fun page(token:String,sessionId:String,throughSeq:Long,beforeSeq:Long):ChatHistoryPage = error("not needed")
    override suspend fun read(token:String,sessionId:String)=facts.value
    override suspend fun send(token:String,sessionId:String,requestId:String,text:String):ChatReceipt=error("not needed")
    override suspend fun receipt(token:String,sessionId:String,requestId:String):ChatReceipt?=null
    override suspend fun stop(token:String,sessionId:String) {}
    companion object { fun projection(g:String,kind:String)=RemoteChatProjection(sessionId="s",generation=g,version=1,cursor=0,durableThroughSeq=-1,throughSeq=0,fromSeq=0,events=listOf(Json.parseToJsonElement("""{"seq":0,"type":"$kind"}""").jsonObject)) }
}
fun main()=runBlocking {
    val backend=ProbeBackend()
    val scope=CoroutineScope(SupervisorJob()+Dispatchers.Unconfined)
    val store=object:ChatSyncStore { var record=ChatSyncRecord(); override suspend fun load(key:ChatSyncKey)=record;override suspend fun save(key:ChatSyncKey,record:ChatSyncRecord){this.record=record} }
    val state=RemoteChatState(backend,scope,store,"https://fairy",100)
    state.bind("alice","s",1); delay(20)
    println("before: connected=${state.snapshot.value.connected}, consumed=${state.snapshot.value.consumedThrough}, generation=${state.snapshot.value.projection?.generation}")
    state.detach()
    backend.facts.value=ProbeBackend.projection("recovered-agent","recovery-closer")
    state.bind("alice","s",1);delay(350)
    println("after reconnects: connected=${state.snapshot.value.connected}, failure=${state.snapshot.value.failure}, generation=${state.snapshot.value.projection?.generation}")
    scope.cancel()
}
